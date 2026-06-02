import type { TodoistApi } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { type Project } from '../tool-helpers.js'
import { CollaboratorSchema } from '../utils/output-schemas.js'
import { summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'
import { type ProjectCollaborator, userResolver } from '../utils/user-resolver.js'

const { FIND_PROJECTS, ADD_TASKS, UPDATE_TASKS } = ToolNames

const ArgsSchema = {
    projectId: z
        .string()
        .min(1)
        .optional()
        .describe(
            'Optional. If provided, searches only collaborators of this project. If omitted, searches across the collaborators of all shared projects the authenticated user can access (plus the authenticated user themselves) — use this for general "find a user" / "who is X" lookups.',
        ),
    searchTerm: z
        .string()
        .optional()
        .describe(
            'Search for a user by name or email (partial and case insensitive match). If omitted, all users are returned.',
        ),
}

const OutputSchema = {
    collaborators: z.array(CollaboratorSchema).describe('The found users.'),
    projectInfo: z
        .object({
            id: z.string().describe('The project ID.'),
            name: z.string().describe('The project name.'),
            isShared: z.boolean().describe('Whether the project is shared.'),
        })
        .optional()
        .describe('Information about the project (only present when projectId was provided).'),
    totalCount: z.number().describe('The total number of users found.'),
    totalAvailable: z
        .number()
        .optional()
        .describe('The total number of available users before the search filter was applied.'),
    appliedFilters: z
        .record(z.string(), z.unknown())
        .describe('The filters that were applied to the search.'),
}

const findProjectCollaborators = {
    name: ToolNames.FIND_PROJECT_COLLABORATORS,
    description:
        'Find Todoist users (collaborators, teammates) by name or email to look up their user ID. Use this whenever the user asks to find, look up, or identify a person — e.g. "find Carrie\'s user ID", "who is Ernesto", "look up a user". When projectId is omitted, searches across the collaborators of every shared project the authenticated user has access to, plus the authenticated user themselves — an empty result means the person is not a collaborator on any project you share with them, not necessarily that they do not exist in Todoist. When projectId is provided, searches only that project. Partial, case-insensitive match on name and email.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { projectId, searchTerm } = args

        if (!projectId) {
            return executeWorkspaceSearch({ searchTerm, client, appliedFilters: args })
        }

        // First, validate that the project exists and get basic info
        let projectName = projectId
        let project: Project
        try {
            project = await client.getProject(projectId)
            if (!project) {
                throw new Error(`Project with ID "${projectId}" not found or not accessible`)
            }
            projectName = project.name

            if (!project.isShared) {
                const textContent = `Project "${projectName}" is not shared and has no collaborators.\n\n**Next steps:**\n• Share the project to enable collaboration\n• Use ${ADD_TASKS} and ${UPDATE_TASKS} for assignment features once shared`

                return {
                    textContent,
                    structuredContent: {
                        collaborators: [],
                        projectInfo: {
                            id: projectId,
                            name: projectName,
                            isShared: false,
                        },
                        totalCount: 0,
                        appliedFilters: args,
                    },
                }
            }
        } catch (error) {
            throw new Error(
                `Failed to access project "${projectId}": ${error instanceof Error ? error.message : 'Unknown error'}`,
            )
        }

        // Get collaborators for the project
        const allCollaborators = await userResolver.getProjectCollaborators(client, projectId)

        if (allCollaborators.length === 0) {
            const textContent = `Project "${projectName}" has no collaborators or collaborator data is not accessible.\n\n**Next steps:**\n• Check project sharing settings\n• Ensure you have permission to view collaborators\n• Try refreshing or re-sharing the project`

            return {
                textContent,
                structuredContent: {
                    collaborators: [],
                    projectInfo: {
                        id: projectId,
                        name: projectName,
                        isShared: true,
                    },
                    totalCount: 0,
                    appliedFilters: args,
                },
            }
        }

        // Filter collaborators if search term provided
        const filteredCollaborators = filterBySearchTerm(allCollaborators, searchTerm)

        const textContent = generateTextContent({
            collaborators: filteredCollaborators,
            projectName,
            searchTerm,
            totalAvailable: allCollaborators.length,
        })

        return {
            textContent,
            structuredContent: {
                collaborators: filteredCollaborators,
                projectInfo: {
                    id: projectId,
                    name: projectName,
                    isShared: true,
                },
                totalCount: filteredCollaborators.length,
                totalAvailable: allCollaborators.length,
                appliedFilters: args,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

async function executeWorkspaceSearch({
    searchTerm,
    client,
    appliedFilters,
}: {
    searchTerm: string | undefined
    client: TodoistApi
    appliedFilters: Record<string, unknown>
}) {
    const sharedCollaborators = await userResolver.getAllCollaborators(client)

    // Always include the authenticated user so "find my user ID" / personal
    // accounts (no shared projects) still work. Mirrors resolveUser().
    const allCollaborators = await prependCurrentUser(client, sharedCollaborators)

    if (allCollaborators.length === 0) {
        const textContent = `No users found. You may have no shared projects, or collaborator data is not accessible.\n\n**Next steps:**\n• Use ${FIND_PROJECTS} to find shared projects\n• Share a project to add collaborators\n• Ensure you have permission to view collaborators`

        return {
            textContent,
            structuredContent: {
                collaborators: [],
                projectInfo: undefined,
                totalCount: 0,
                totalAvailable: 0,
                appliedFilters,
            },
        }
    }

    const filteredCollaborators = filterBySearchTerm(allCollaborators, searchTerm)

    const textContent = generateTextContent({
        collaborators: filteredCollaborators,
        projectName: undefined,
        searchTerm,
        totalAvailable: allCollaborators.length,
    })

    return {
        textContent,
        structuredContent: {
            collaborators: filteredCollaborators,
            projectInfo: undefined,
            totalCount: filteredCollaborators.length,
            totalAvailable: allCollaborators.length,
            appliedFilters,
        },
    }
}

async function prependCurrentUser(
    client: TodoistApi,
    collaborators: ProjectCollaborator[],
): Promise<ProjectCollaborator[]> {
    try {
        const currentUser = await client.getUser()
        if (!currentUser) return collaborators
        if (collaborators.some((c) => c.id === currentUser.id)) return collaborators
        return [
            { id: currentUser.id, name: currentUser.fullName, email: currentUser.email },
            ...collaborators,
        ]
    } catch {
        return collaborators
    }
}

function filterBySearchTerm(
    collaborators: ProjectCollaborator[],
    searchTerm: string | undefined,
): ProjectCollaborator[] {
    if (!searchTerm) {
        return collaborators
    }
    const searchLower = searchTerm.toLowerCase().trim()
    return collaborators.filter(
        (collaborator) =>
            collaborator.name.toLowerCase().includes(searchLower) ||
            collaborator.email?.toLowerCase().includes(searchLower),
    )
}

function generateTextContent({
    collaborators,
    projectName,
    searchTerm,
    totalAvailable,
}: {
    collaborators: ProjectCollaborator[]
    projectName: string | undefined
    searchTerm?: string
    totalAvailable: number
}) {
    const scope = projectName ? `project "${projectName}"` : 'workspace'
    const baseLabel = projectName ? 'Project collaborators' : 'Workspace users'

    const subject = searchTerm ? `${baseLabel} matching "${searchTerm}"` : baseLabel

    const filterHints: string[] = []
    if (searchTerm) {
        filterHints.push(`matching "${searchTerm}"`)
    }
    filterHints.push(`in ${scope}`)

    let previewLines: string[] = []
    if (collaborators.length > 0) {
        previewLines = collaborators.slice(0, 10).map((collaborator) => {
            const displayName = collaborator.name || 'Unknown Name'
            const email = collaborator.email || 'No email'
            return `• ${displayName} (${email}) - ID: ${collaborator.id}`
        })

        if (collaborators.length > 10) {
            previewLines.push(`... and ${collaborators.length - 10} more`)
        }
    }

    // Empty-result messages for the no-collaborators-at-all cases are emitted
    // by the execute paths before they reach generateTextContent, so if we
    // end up here with an empty list it's necessarily because searchTerm
    // filtered everyone out.
    const zeroReasonHints: string[] = []
    if (collaborators.length === 0 && searchTerm) {
        zeroReasonHints.push(`No users match "${searchTerm}"`)
        zeroReasonHints.push('Try a broader search term or check spelling')
        if (totalAvailable > 0) {
            zeroReasonHints.push(`${totalAvailable} users available without filter`)
        }
    }

    const nextSteps: string[] = []
    if (collaborators.length > 0) {
        nextSteps.push(`Use ${ADD_TASKS} with responsibleUser to assign new tasks`)
        nextSteps.push(`Use ${UPDATE_TASKS} with responsibleUser to reassign existing tasks`)
        nextSteps.push('Use user names, emails, or IDs for assignments')
    } else {
        nextSteps.push(`Use ${FIND_PROJECTS} to find other projects`)
        if (searchTerm && totalAvailable > 0) {
            nextSteps.push('Try searching without filters to see all users')
        }
    }

    return summarizeList({
        subject,
        count: collaborators.length,
        filterHints,
        previewLines: previewLines.join('\n'),
        zeroReasonHints,
        nextSteps,
    })
}

export { findProjectCollaborators }
