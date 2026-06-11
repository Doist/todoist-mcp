import type { PersonalProject, WorkspaceProject } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatToolExecutionError } from '../tool-execution-error.js'
import { mapProject } from '../tool-helpers.js'
import { ColorSchema } from '../utils/colors.js'
import { DisplayLimits } from '../utils/constants.js'
import { FailureSchema, ProjectSchema as ProjectOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const ProjectUpdateSchema = z.object({
    id: z.string().min(1).describe('The ID of the project to update.'),
    name: z.string().min(1).optional().describe('The new name of the project.'),
    isFavorite: z.boolean().optional().describe('Whether the project is a favorite.'),
    viewStyle: z.enum(['list', 'board', 'calendar']).optional().describe('The project view style.'),
    color: ColorSchema,
})

type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>
type SkipReason = 'no-fields' | 'no-valid-values'

const ArgsSchema = {
    projects: z.array(ProjectUpdateSchema).min(1).describe('The projects to update.'),
}

const OutputSchema = {
    projects: z.array(ProjectOutputSchema).describe('The updated projects.'),
    totalCount: z.number().describe('The total number of projects updated.'),
    updatedProjectIds: z.array(z.string()).describe('The IDs of the updated projects.'),
    failures: z
        .array(FailureSchema)
        .describe(
            'Projects that could not be updated, with the reason for each. A failure here does not affect the other projects in the batch — do not retry the whole batch; address or drop the failed items.',
        ),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('The number of projects actually updated.'),
            skippedCount: z.number().describe('The number of projects skipped (no changes).'),
            failureCount: z.number().describe('The number of projects that failed to update.'),
        })
        .describe('Summary of operations performed.'),
}

const updateProjects = {
    name: ToolNames.UPDATE_PROJECTS,
    description: 'Update multiple existing projects with new values.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        const { projects } = args

        type Outcome =
            | { kind: 'updated'; project: PersonalProject | WorkspaceProject }
            | { kind: 'skipped'; reason: SkipReason }
            | { kind: 'failed'; item: string; error: string }

        // Each project is updated independently: a failure on one (for example, the API
        // rejecting it with a 403 permission error) must not discard the projects that
        // succeeded nor collapse into one opaque batch error that invites a full retry.
        const settled = await Promise.allSettled(
            projects.map(async (project): Promise<Outcome> => {
                const skipReason = getSkipReason(project)
                if (skipReason !== null) return { kind: 'skipped', reason: skipReason }

                const { id, ...updateArgs } = project
                const updated = await client.updateProject(id, updateArgs)
                return { kind: 'updated', project: updated }
            }),
        )

        const outcomes: Outcome[] = settled.map((result, index) => {
            if (result.status === 'fulfilled') return result.value
            return {
                kind: 'failed',
                item: projects[index]?.id ?? `Project ${index + 1}`,
                error: formatToolExecutionError(result.reason),
            }
        })

        const updatedProjects = outcomes
            .filter(
                (o): o is { kind: 'updated'; project: PersonalProject | WorkspaceProject } =>
                    o.kind === 'updated',
            )
            .map((o) => mapProject(o.project))

        const failures = outcomes
            .filter(
                (o): o is { kind: 'failed'; item: string; error: string } => o.kind === 'failed',
            )
            .map(({ item, error }) => ({ item, error }))

        const skippedNoFields = outcomes.filter(
            (o) => o.kind === 'skipped' && o.reason === 'no-fields',
        ).length

        const skippedNoValidValues = outcomes.filter(
            (o) => o.kind === 'skipped' && o.reason === 'no-valid-values',
        ).length

        // If nothing was updated but real failures occurred, surface a hard error instead
        // of a misleading success. (Skip-only batches still return normally.)
        if (updatedProjects.length === 0 && failures.length > 0) {
            const details = failures.map((f) => `"${f.item}": ${f.error}`).join('; ')
            throw new Error(`All ${failures.length} project update(s) failed: ${details}`)
        }

        const textContent = generateTextContent({
            projects: updatedProjects,
            skippedNoFields,
            skippedNoValidValues,
            failures,
        })

        return {
            textContent,
            structuredContent: {
                projects: updatedProjects,
                totalCount: updatedProjects.length,
                updatedProjectIds: updatedProjects.map((project) => project.id),
                failures,
                appliedOperations: {
                    updateCount: updatedProjects.length,
                    skippedCount: skippedNoFields + skippedNoValidValues,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    projects,
    skippedNoFields,
    skippedNoValidValues,
    failures,
}: {
    projects: Array<{ id: string; name: string }>
    skippedNoFields: number
    skippedNoValidValues: number
    failures: Array<{ item: string; error: string }>
}) {
    const count = projects.length
    const projectList = projects.map((project) => `• ${project.name} (id=${project.id})`).join('\n')

    let summary = `Updated ${count} project${count === 1 ? '' : 's'}`

    const skipParts: string[] = []
    if (skippedNoFields > 0) {
        skipParts.push(`${skippedNoFields} skipped - no changes`)
    }
    if (skippedNoValidValues > 0) {
        skipParts.push(`${skippedNoValidValues} skipped - no valid field values`)
    }

    if (skipParts.length > 0) {
        summary += ` (${skipParts.join(', ')})`
    }

    if (count > 0) {
        summary += `:\n${projectList}`
    }

    if (failures.length === 0) {
        return summary
    }

    const shown = failures.slice(0, DisplayLimits.MAX_FAILURES_SHOWN)
    const remaining = failures.length - shown.length
    const failureLines = shown.map((f) => `    ${f.item}: ${f.error}`).join('\n')
    const moreInfo = remaining > 0 ? `\n    +${remaining} more` : ''

    return `${summary}\nFailed (${failures.length}) - not retried automatically; address or drop these items:\n${failureLines}${moreInfo}`
}

function getSkipReason({ id: _id, ...otherUpdateArgs }: ProjectUpdate): SkipReason | null {
    const values = Object.values(otherUpdateArgs)
    if (values.length === 0) return 'no-fields'
    if (values.every((v) => v === undefined)) return 'no-valid-values'
    return null
}

export { updateProjects }
