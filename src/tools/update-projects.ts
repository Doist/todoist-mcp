import type { PersonalProject, WorkspaceProject } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapProject } from '../tool-helpers.js'
import { ColorSchema } from '../utils/colors.js'
import { ProjectSchema as ProjectOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const REMOVE_SENTINEL = 'remove'

const ProjectUpdateSchema = z.object({
    id: z.string().min(1).describe('The ID of the project to update.'),
    name: z.string().min(1).optional().describe('The new name of the project.'),
    isFavorite: z.boolean().optional().describe('Whether the project is a favorite.'),
    viewStyle: z.enum(['list', 'board', 'calendar']).optional().describe('The project view style.'),
    description: z
        .preprocess(
            (value) => (value === null ? REMOVE_SENTINEL : value),
            // Reject "" so `"remove"` is the single documented clear path
            // (matching update-goals/update-tasks); `null` is preprocessed above.
            z
                .string()
                .min(1)
                .describe(
                    `The description of the project (Markdown). Use "${REMOVE_SENTINEL}" to clear it.`,
                ),
        )
        .optional(),
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
    appliedOperations: z
        .object({
            updateCount: z.number().describe('The number of projects actually updated.'),
            skippedCount: z.number().describe('The number of projects skipped (no changes).'),
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

        type Result =
            | { kind: 'updated'; project: PersonalProject | WorkspaceProject }
            | { kind: 'skipped'; reason: SkipReason }

        const results: Result[] = await Promise.all(
            projects.map(async (project): Promise<Result> => {
                const skipReason = getSkipReason(project)
                if (skipReason !== null) return { kind: 'skipped', reason: skipReason }

                const { id, description, ...rest } = project
                // `"remove"` (and legacy `null`) clears via an empty string, the
                // project clear value (backend NULL_KEEPS_UNCHANGED).
                const updateArgs: Parameters<typeof client.updateProject>[1] = {
                    ...rest,
                    ...(description !== undefined
                        ? { description: description === REMOVE_SENTINEL ? '' : description }
                        : {}),
                }
                const updated = await client.updateProject(id, updateArgs)
                return { kind: 'updated', project: updated }
            }),
        )

        const updatedProjects = results
            .filter(
                (r): r is { kind: 'updated'; project: PersonalProject | WorkspaceProject } =>
                    r.kind === 'updated',
            )
            .map((r) => mapProject(r.project))

        const skippedNoFields = results.filter(
            (r): r is { kind: 'skipped'; reason: SkipReason } =>
                r.kind === 'skipped' && r.reason === 'no-fields',
        ).length

        const skippedNoValidValues = results.filter(
            (r): r is { kind: 'skipped'; reason: SkipReason } =>
                r.kind === 'skipped' && r.reason === 'no-valid-values',
        ).length

        const textContent = generateTextContent({
            projects: updatedProjects,
            skippedNoFields,
            skippedNoValidValues,
        })

        return {
            textContent,
            structuredContent: {
                projects: updatedProjects,
                totalCount: updatedProjects.length,
                updatedProjectIds: updatedProjects.map((project) => project.id),
                appliedOperations: {
                    updateCount: updatedProjects.length,
                    skippedCount: skippedNoFields + skippedNoValidValues,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    projects,
    skippedNoFields,
    skippedNoValidValues,
}: {
    projects: Array<{ id: string; name: string }>
    skippedNoFields: number
    skippedNoValidValues: number
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

    return summary
}

function getSkipReason({ id: _id, ...otherUpdateArgs }: ProjectUpdate): SkipReason | null {
    const values = Object.values(otherUpdateArgs)
    if (values.length === 0) return 'no-fields'
    if (values.every((v) => v === undefined)) return 'no-valid-values'
    return null
}

export { updateProjects }
