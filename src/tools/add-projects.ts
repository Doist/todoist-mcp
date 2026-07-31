import type { PersonalProject, WorkspaceProject } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { mapProject } from '../tool-helpers.js'
import { ColorSchema } from '../utils/colors.js'
import { FailureSchema, ProjectSchema as ProjectOutputSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'

const ProjectSchema = z.object({
    name: z.string().min(1).describe('The name of the project.'),
    parentId: z
        .string()
        .optional()
        .describe('The ID of the parent project. If provided, creates this as a sub-project.'),
    isFavorite: z
        .boolean()
        .optional()
        .describe('Whether the project is a favorite. Defaults to false.'),
    viewStyle: z
        .enum(['list', 'board', 'calendar'])
        .optional()
        .describe('The project view style. Defaults to "list".'),
    description: z
        .string()
        .optional()
        .describe('The description of the project. Supports Markdown.'),
    color: ColorSchema,
    workspace: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
            'The workspace to create the project in. Accepts a workspace name or workspace ID. ' +
                'If not provided, creates a personal project. Use list-workspaces to see available workspaces.',
        ),
})

const ArgsSchema = {
    projects: z.array(ProjectSchema).min(1).describe('The array of projects to add.'),
}

const OutputSchema = {
    projects: z.array(ProjectOutputSchema).describe('The created projects.'),
    totalCount: z.number().describe('The total number of projects created.'),
    failures: z
        .array(FailureSchema)
        .describe(
            'Projects that could not be created, with the reason for each. A failure here does not affect the other projects in the batch — do not retry the whole batch; address or drop the failed items.',
        ),
    totalRequested: z.number().describe('The total number of projects requested.'),
    successCount: z.number().describe('The number of successfully created projects.'),
    failureCount: z.number().describe('The number of failed project creations.'),
}

const addProjects = {
    name: ToolNames.ADD_PROJECTS,
    description: 'Add one or more new projects.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ projects }, client) {
        const workspaceResolutions = new Map<string, Promise<string>>()

        const resolveWorkspaceId = (workspace: string | undefined) => {
            if (!workspace) {
                return Promise.resolve(undefined)
            }

            let resolution = workspaceResolutions.get(workspace)
            if (!resolution) {
                resolution = executeWithRetry(() =>
                    workspaceResolver.resolveWorkspace(client, workspace),
                ).then(({ workspaceId }) => workspaceId)
                workspaceResolutions.set(workspace, resolution)
            }

            return resolution
        }

        // Each project is created independently: a failure on one (for example, the API
        // rejecting it with a 403 permission error) must not discard the projects that
        // succeeded nor collapse into one opaque batch error that invites a full retry.
        // Per-item calls go through executeWithRetry so transient 5xx failures still get
        // the same backoff the registerTool() wrapper applies to single-call tools.
        const settled = await Promise.allSettled(
            projects.map(async ({ workspace, ...rest }) => {
                const workspaceId = await resolveWorkspaceId(workspace)
                return await executeWithRetry(() =>
                    client.addProject({ ...rest, ...(workspaceId ? { workspaceId } : {}) }),
                )
            }),
        )

        const newProjects: (PersonalProject | WorkspaceProject)[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                newProjects.push(result.value)
            } else {
                failures.push({
                    item: projects[index]?.name ?? `Project ${index + 1}`,
                    error: formatBatchItemError(result.reason),
                })
            }
        })

        const mappedProjects = newProjects.map(mapProject)
        const textContent = generateTextContent({ projects: newProjects, failures })

        return {
            textContent,
            structuredContent: {
                projects: mappedProjects,
                totalCount: mappedProjects.length,
                failures,
                totalRequested: projects.length,
                successCount: mappedProjects.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    projects,
    failures,
}: {
    projects: (PersonalProject | WorkspaceProject)[]
    failures: Array<{ item: string; error: string }>
}) {
    const count = projects.length
    const projectList = projects.map((project) => `• ${project.name} (id=${project.id})`).join('\n')

    const summary =
        count > 0
            ? `Added ${count} project${count === 1 ? '' : 's'}:\n${projectList}`
            : 'Added 0 projects'

    return appendFailureSummary(summary, failures)
}

export { addProjects }
