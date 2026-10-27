import type { PersonalProject, TodoistApi, WorkspaceProject } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { fetchAllActiveProjects, isPersonalProject, mapProject } from '../tool-helpers.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { ColorSchema } from '../utils/colors.js'
import { createLimiter } from '../utils/concurrency.js'
import { FailureSchema, ProjectSchema as ProjectOutputSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeCreateWithRetry, executeWithRetry } from '../utils/retry.js'
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
        .describe('Projects that could not be created, with the reason for each.'),
    totalRequested: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
}

const PersonalProjectLimitSchema = z.number().int().nonnegative()

const addProjects = {
    name: ToolNames.ADD_PROJECTS,
    description: 'Add one or more new projects.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ projects }, client) {
        const workspaceResolutions = new Map<string, Promise<string>>()
        const limitPersonalCreation = createLimiter(1)
        let personalCapacity: ReturnType<typeof loadPersonalProjectCapacity> | undefined

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
        // Each create goes through executeCreateWithRetry, which retries a 503 but not a
        // 502/504, since the item may already exist and the API cannot dedupe a repeat.
        const settled = await Promise.allSettled(
            projects.map(async ({ workspace, ...rest }) => {
                const workspaceId = await resolveWorkspaceId(workspace)
                const createProject = () =>
                    executeCreateWithRetry(() =>
                        client.addProject({ ...rest, ...(workspaceId ? { workspaceId } : {}) }),
                    )

                if (workspace) {
                    return await createProject()
                }

                // The quota snapshot and successful writes share one lane within this
                // batch. Other tool executions and clients can still change capacity.
                return await limitPersonalCreation(async () => {
                    personalCapacity ??= loadPersonalProjectCapacity(client)
                    const capacity = await personalCapacity
                    if (capacity.activeCount >= capacity.maxProjects) {
                        throw new Error(
                            `Your account has reached its limit of ${capacity.maxProjects} active personal projects. ` +
                                'This project was not created. Archive or delete a personal project, or upgrade to a plan with a higher limit, then retry this item.',
                        )
                    }

                    const project = await createProject()
                    capacity.activeCount++
                    return project
                })
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
        logBatchFailures(ToolNames.ADD_PROJECTS, projects.length, failures, { redactItems: true })

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

async function loadPersonalProjectCapacity(client: TodoistApi) {
    try {
        const [limits, projects] = await Promise.all([
            executeWithRetry(() =>
                client.sync({ resourceTypes: ['user_plan_limits'], syncToken: '*' }),
            ),
            executeWithRetry(() => fetchAllActiveProjects(client)),
        ])
        // The SDK preserves this field via a loose schema, so validate it before use.
        const maxProjects = PersonalProjectLimitSchema.parse(
            limits.userPlanLimits?.current?.maxProjects,
        )
        const activeCount = projects.filter(
            (project) =>
                isPersonalProject(project) &&
                !project.inboxProject &&
                !project.isArchived &&
                !project.isDeleted,
        ).length

        return { maxProjects, activeCount }
    } catch {
        throw new Error(
            'Could not verify your personal project limit. This project was not created. Retry this item later.',
        )
    }
}

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
