import type { PersonalProject, TodoistApi, WorkspaceProject } from '@doist/todoist-sdk'
import { fetchAllPages } from '../tool-helpers.js'

export type ResolvedUser = {
    userId: string
    displayName: string
    email: string | null
}

export type ProjectCollaborator = {
    id: string
    name: string
    email: string | null
}

// User resolution cache for performance with TTL
const userResolutionCache = new Map<
    string,
    {
        result: ResolvedUser | null
        timestamp: number
    }
>()

// Project collaborators cache
const collaboratorsCache = new Map<
    string,
    {
        result: ProjectCollaborator[]
        timestamp: number
    }
>()

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/** Keyword that resolves to the current authenticated user. */
export const SELF_USER_KEYWORD = 'me' as const

export class UserResolver {
    /**
     * Resolve a user name or ID to a user ID by looking up collaborators across all shared projects.
     * Supports exact name matches, partial matches, email matches, and the "me" keyword.
     */
    async resolveUser(client: TodoistApi, nameOrId: string): Promise<ResolvedUser | null> {
        // Input validation
        if (!nameOrId || nameOrId.trim().length === 0) {
            return null
        }

        const trimmedInput = nameOrId.trim()

        // Check cache first
        const cached = userResolutionCache.get(trimmedInput)
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.result
        }

        // Handle "me" keyword — resolve to the current authenticated user
        // Case-insensitive: LLMs may send "Me", "ME", etc.
        // Not cached: the cache is process-global and "me" resolves differently per client/account
        if (trimmedInput.toLowerCase() === SELF_USER_KEYWORD) {
            try {
                const currentUser = await client.getUser()
                return {
                    userId: currentUser.id,
                    displayName: currentUser.fullName,
                    email: currentUser.email,
                }
            } catch (_error) {
                return null
            }
        }

        // If it looks like a user ID already, return as-is
        // Support numeric IDs and alphanumeric IDs but avoid obvious user names
        if (
            /^[0-9]+$/.test(trimmedInput) ||
            (/^[a-f0-9-]{8,}$/i.test(trimmedInput) && trimmedInput.includes('-')) ||
            (/^[a-z0-9_]{6,}$/i.test(trimmedInput) &&
                !/^[a-z]+[\s-]/.test(trimmedInput) &&
                /[0-9_]/.test(trimmedInput))
        ) {
            const result = { userId: trimmedInput, displayName: trimmedInput, email: trimmedInput }
            userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
            return result
        }

        try {
            // Get all collaborators from shared projects
            let allCollaborators = await this.getAllCollaborators(client)

            // Try to get current user and prepend to collaborators list
            // This ensures the current user is found even if they have no shared projects
            try {
                const currentUser = await client.getUser()
                if (currentUser) {
                    const currentUserAsCollaborator: ProjectCollaborator = {
                        id: currentUser.id,
                        name: currentUser.fullName,
                        email: currentUser.email,
                    }
                    // Only add if not already in the list
                    if (!allCollaborators.some((c) => c.id === currentUser.id)) {
                        allCollaborators = [currentUserAsCollaborator, ...allCollaborators]
                    }
                }
            } catch (_error) {
                // Continue with collaborators only if getUser fails
            }

            if (allCollaborators.length === 0) {
                const result = null // No users found (no current user, no shared projects)
                userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
                return result
            }

            const searchTerm = nameOrId.toLowerCase().trim()

            // Try exact ID match first
            let match = allCollaborators.find((c) => c.id === trimmedInput)
            if (match) {
                const result = { userId: match.id, displayName: match.name, email: match.email }
                userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
                return result
            }

            // Try exact name match
            match = allCollaborators.find((c) => c.name.toLowerCase() === searchTerm)
            if (match) {
                const result = { userId: match.id, displayName: match.name, email: match.email }
                userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
                return result
            }

            // Try exact email match
            match = allCollaborators.find((c) => c.email?.toLowerCase() === searchTerm)
            if (match) {
                const result = { userId: match.id, displayName: match.name, email: match.email }
                userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
                return result
            }

            // Try partial name match (contains)
            match = allCollaborators.find((c) => c.name.toLowerCase().includes(searchTerm))
            if (match) {
                const result = { userId: match.id, displayName: match.name, email: match.email }
                userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
                return result
            }

            // Try partial email match
            match = allCollaborators.find((c) => c.email?.toLowerCase().includes(searchTerm))
            if (match) {
                const result = { userId: match.id, displayName: match.name, email: match.email }
                userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
                return result
            }

            // No match found
            const result = null
            userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
            return result
        } catch (_error) {
            // If we can't fetch collaborators, return null instead of dangerous fallback
            const result = null
            userResolutionCache.set(trimmedInput, { result, timestamp: Date.now() })
            return result
        }
    }

    /**
     * Validate that a user is a collaborator on a specific project
     */
    async validateProjectCollaborator(
        client: TodoistApi,
        projectId: string,
        userId: string,
    ): Promise<boolean> {
        try {
            const collaborators = await this.getProjectCollaborators(client, projectId)
            return collaborators.some((collaborator) => collaborator.id === userId)
        } catch (_error) {
            return false
        }
    }

    /**
     * Get collaborators for a specific project
     */
    async getProjectCollaborators(
        client: TodoistApi,
        projectId: string,
    ): Promise<ProjectCollaborator[]> {
        // Check cache first
        const cacheKey = `project_${projectId}`
        const cached = collaboratorsCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.result
        }

        try {
            const response = await client.getProjectCollaborators(projectId)
            // API returns { results: [...], nextCursor: null } or just array
            const collaborators = Array.isArray(response) ? response : response.results || []

            const validCollaborators = collaborators.filter((c) => c?.id && c.name)

            collaboratorsCache.set(cacheKey, {
                result: validCollaborators,
                timestamp: Date.now(),
            })

            return validCollaborators
        } catch (_error) {
            // Return empty array on error, don't cache failed requests
            return []
        }
    }

    /**
     * Get all collaborators from all shared projects, deduplicated by user ID.
     */
    async getAllCollaborators(client: TodoistApi): Promise<ProjectCollaborator[]> {
        // Check cache first
        const cacheKey = 'all_collaborators'
        const cached = collaboratorsCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.result
        }

        try {
            // Get all projects to find shared ones (paginated — accounts with
            // more than one page of projects would otherwise miss collaborators
            // from later pages).
            const projects: (PersonalProject | WorkspaceProject)[] = await fetchAllPages({
                apiMethod: client.getProjects.bind(client),
                args: {},
            })
            const sharedProjects = projects.filter((p) => p.isShared)

            if (sharedProjects.length === 0) {
                const result: ProjectCollaborator[] = []
                collaboratorsCache.set(cacheKey, { result, timestamp: Date.now() })
                return result
            }

            // Collect all collaborators from shared projects in parallel
            const allCollaborators: ProjectCollaborator[] = []
            const seenIds = new Set<string>()

            const collaboratorPromises = sharedProjects.map((project) =>
                this.getProjectCollaborators(client, project.id),
            )

            const collaboratorResults = await Promise.allSettled(collaboratorPromises)

            for (const result of collaboratorResults) {
                if (result.status === 'fulfilled') {
                    for (const collaborator of result.value) {
                        if (collaborator && !seenIds.has(collaborator.id)) {
                            allCollaborators.push(collaborator)
                            seenIds.add(collaborator.id)
                        }
                    }
                }
                // Skip failed projects, continue with others
            }

            collaboratorsCache.set(cacheKey, {
                result: allCollaborators,
                timestamp: Date.now(),
            })

            return allCollaborators
        } catch (_error) {
            // Return empty array on error, don't cache failed requests
            return []
        }
    }

    /**
     * Clear all caches - useful for testing
     */
    clearCache(): void {
        userResolutionCache.clear()
        collaboratorsCache.clear()
    }
}

// Export singleton instance
export const userResolver = new UserResolver()

// Legacy function for backwards compatibility
export async function resolveUserNameToId(
    client: TodoistApi,
    nameOrId: string,
): Promise<ResolvedUser | null> {
    return userResolver.resolveUser(client, nameOrId)
}
