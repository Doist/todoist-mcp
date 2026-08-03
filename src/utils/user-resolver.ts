import type { PersonalProject, TodoistApi, WorkspaceProject } from '@doist/todoist-sdk'
import { fetchAllPages } from '../tool-helpers.js'

export type ResolvedUser = {
    userId: string
    displayName: string
    email: string
}

export type ProjectCollaborator = {
    id: string
    name: string
    email: string
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const MAX_USER_RESOLUTION_CACHE_ENTRIES = 10_000
const MAX_COLLABORATORS_CACHE_ENTRIES = 1_000

type CacheEntry<T> = {
    result: T
    timestamp: number
}

/**
 * A bounded, TTL-aware LRU cache. Expired entries are removed when read and
 * when space is needed; the least recently used live entry is then evicted.
 */
export class BoundedTtlCache<T> {
    private readonly entries = new Map<string, CacheEntry<T>>()

    constructor(
        private readonly maxEntries: number,
        private readonly ttl: number,
    ) {}

    get(key: string): T | undefined {
        const entry = this.entries.get(key)
        if (!entry) return undefined

        if (Date.now() - entry.timestamp >= this.ttl) {
            this.entries.delete(key)
            return undefined
        }

        // Reinsert so Map insertion order tracks least- to most-recent use.
        this.entries.delete(key)
        this.entries.set(key, entry)
        return entry.result
    }

    set(key: string, result: T): void {
        // Replacing an entry must not consume another cache slot.
        this.entries.delete(key)

        if (this.entries.size >= this.maxEntries) {
            this.pruneExpiredEntries()
        }
        if (this.entries.size >= this.maxEntries) {
            const oldestKey = this.entries.keys().next().value
            if (oldestKey !== undefined) this.entries.delete(oldestKey)
        }

        this.entries.set(key, { result, timestamp: Date.now() })
    }

    clear(): void {
        this.entries.clear()
    }

    get size(): number {
        return this.entries.size
    }

    private pruneExpiredEntries(): void {
        const now = Date.now()
        for (const [key, entry] of this.entries) {
            if (now - entry.timestamp >= this.ttl) {
                this.entries.delete(key)
            }
        }
    }
}

// User resolution cache for performance with TTL.
const userResolutionCache = new BoundedTtlCache<ResolvedUser | null>(
    MAX_USER_RESOLUTION_CACHE_ENTRIES,
    CACHE_TTL,
)

// Project and aggregate collaborator caches store larger result sets, so use a lower limit.
const collaboratorsCache = new BoundedTtlCache<ProjectCollaborator[]>(
    MAX_COLLABORATORS_CACHE_ENTRIES,
    CACHE_TTL,
)

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

        // Handle "me" keyword — resolve to the current authenticated user
        // Case-insensitive: LLMs may send "Me", "ME", etc.
        // Not cached because it always reflects the current authenticated user
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
            return { userId: trimmedInput, displayName: trimmedInput, email: trimmedInput }
        }

        const cacheScope = await this.getCacheScope(client)
        const cacheKey = this.getCacheKey(cacheScope, `user_${trimmedInput}`)
        const cached = cacheKey ? userResolutionCache.get(cacheKey) : undefined
        if (cached !== undefined) return cached

        const cacheResult = (result: ResolvedUser | null) => {
            if (cacheKey) {
                userResolutionCache.set(cacheKey, result)
            }
            return result
        }

        try {
            // Get all collaborators from shared projects
            let allCollaborators = await this.getAllCollaborators(client, cacheScope)

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
                return cacheResult(null)
            }

            const searchTerm = nameOrId.toLowerCase().trim()

            // Try exact ID match first
            let match = allCollaborators.find((c) => c.id === trimmedInput)
            if (match) {
                return cacheResult({
                    userId: match.id,
                    displayName: match.name,
                    email: match.email,
                })
            }

            // Try exact name match
            match = allCollaborators.find((c) => c.name.toLowerCase() === searchTerm)
            if (match) {
                return cacheResult({
                    userId: match.id,
                    displayName: match.name,
                    email: match.email,
                })
            }

            // Try exact email match
            match = allCollaborators.find((c) => c.email.toLowerCase() === searchTerm)
            if (match) {
                return cacheResult({
                    userId: match.id,
                    displayName: match.name,
                    email: match.email,
                })
            }

            // Try partial name match (contains)
            match = allCollaborators.find((c) => c.name.toLowerCase().includes(searchTerm))
            if (match) {
                return cacheResult({
                    userId: match.id,
                    displayName: match.name,
                    email: match.email,
                })
            }

            // Try partial email match
            match = allCollaborators.find((c) => c.email.toLowerCase().includes(searchTerm))
            if (match) {
                return cacheResult({
                    userId: match.id,
                    displayName: match.name,
                    email: match.email,
                })
            }

            // No match found
            return cacheResult(null)
        } catch (_error) {
            // If we can't fetch collaborators, return null instead of dangerous fallback
            return cacheResult(null)
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
        cacheScope?: string | null,
    ): Promise<ProjectCollaborator[]> {
        const resolvedCacheScope =
            cacheScope === undefined ? await this.getCacheScope(client) : cacheScope
        const cacheKey = this.getCacheKey(resolvedCacheScope, `project_${projectId}`)
        const cached = cacheKey ? collaboratorsCache.get(cacheKey) : undefined
        if (cached !== undefined) return cached

        try {
            const response = await client.getProjectCollaborators(projectId)
            // API returns { results: [...], nextCursor: null } or just array
            const collaborators = Array.isArray(response) ? response : response.results || []

            const validCollaborators = collaborators.filter((c) => c?.id && c.name && c.email)

            if (cacheKey) {
                collaboratorsCache.set(cacheKey, validCollaborators)
            }

            return validCollaborators
        } catch (_error) {
            // Return empty array on error, don't cache failed requests
            return []
        }
    }

    /**
     * Get all collaborators from all shared projects, deduplicated by user ID.
     */
    async getAllCollaborators(
        client: TodoistApi,
        cacheScope?: string | null,
    ): Promise<ProjectCollaborator[]> {
        const resolvedCacheScope =
            cacheScope === undefined ? await this.getCacheScope(client) : cacheScope
        const cacheKey = this.getCacheKey(resolvedCacheScope, 'all_collaborators')
        const cached = cacheKey ? collaboratorsCache.get(cacheKey) : undefined
        if (cached !== undefined) return cached

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
                if (cacheKey) {
                    collaboratorsCache.set(cacheKey, result)
                }
                return result
            }

            // Collect all collaborators from shared projects in parallel
            const allCollaborators: ProjectCollaborator[] = []
            const seenIds = new Set<string>()

            const collaboratorPromises = sharedProjects.map((project) =>
                this.getProjectCollaborators(client, project.id, resolvedCacheScope),
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

            if (cacheKey) {
                collaboratorsCache.set(cacheKey, allCollaborators)
            }

            return allCollaborators
        } catch (_error) {
            // Return empty array on error, don't cache failed requests
            return []
        }
    }

    private async getCacheScope(client: TodoistApi): Promise<string | null> {
        try {
            const currentUser = await client.getUser()
            return currentUser?.id ?? null
        } catch (_error) {
            return null
        }
    }

    private getCacheKey(cacheScope: string | null, cacheKey: string): string | null {
        return cacheScope ? `${cacheScope}:${cacheKey}` : null
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
