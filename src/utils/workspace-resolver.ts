import type { TodoistApi, Workspace } from '@doist/todoist-sdk'

export type ResolvedWorkspace = {
    workspaceId: string
    workspaceName: string
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

type WorkspaceResolverState = {
    cache: { workspaces: Workspace[]; timestamp: number } | null
    inFlightWorkspaces: Promise<Workspace[]> | null
}

/**
 * Check if a string looks like a workspace ID (purely numeric).
 */
export function looksLikeWorkspaceId(ref: string): boolean {
    return /^\d+$/.test(ref)
}

export class WorkspaceResolver {
    // Cached data and pending requests are scoped to the client, never shared across
    // clients. The HTTP transport builds a client per request, so there this only
    // deduplicates within one request; the TTL matters for long-lived stdio clients.
    private stateByClient = new WeakMap<TodoistApi, WorkspaceResolverState>()

    private async getWorkspaces(client: TodoistApi): Promise<Workspace[]> {
        let state = this.stateByClient.get(client)
        if (!state) {
            state = { cache: null, inFlightWorkspaces: null }
            this.stateByClient.set(client, state)
        }

        if (state.cache && Date.now() - state.cache.timestamp < CACHE_TTL) {
            return state.cache.workspaces
        }

        if (state.inFlightWorkspaces) {
            return state.inFlightWorkspaces
        }

        // Mutate only this captured state, even if clearCache replaces the map.
        const request = client
            .getWorkspaces()
            .then((workspaces) => {
                state.cache = { workspaces, timestamp: Date.now() }
                return workspaces
            })
            .finally(() => {
                if (state.inFlightWorkspaces === request) {
                    state.inFlightWorkspaces = null
                }
            })
        state.inFlightWorkspaces = request
        return request
    }

    /**
     * Resolve a workspace name or ID to a workspace ID and name.
     *
     * Resolution order:
     * 1. Exact ID match (always tried first for any input)
     * 2. If input looks like an ID (numeric) but wasn't found, pass through as-is (API validates)
     * 3. Exact case-insensitive name match
     * 4. Unique partial case-insensitive name match
     * 5. Multiple partial matches → throw ambiguous error
     * 6. No match → throw not-found error
     */
    async resolveWorkspace(client: TodoistApi, nameOrId: string): Promise<ResolvedWorkspace> {
        const trimmed = nameOrId.trim()
        if (!trimmed) {
            throw new Error('Workspace reference cannot be empty')
        }

        const workspaces = await this.getWorkspaces(client)

        // Try exact ID match first (for any input)
        const byId = workspaces.find((w) => w.id === trimmed)
        if (byId) {
            return { workspaceId: byId.id, workspaceName: byId.name }
        }

        // If it looks like an ID but wasn't found, pass through as-is (API will validate)
        if (looksLikeWorkspaceId(trimmed)) {
            return { workspaceId: trimmed, workspaceName: trimmed }
        }

        const searchTerm = trimmed.toLowerCase()

        // Exact case-insensitive name match
        const exactMatch = workspaces.find((w) => w.name.toLowerCase() === searchTerm)
        if (exactMatch) {
            return { workspaceId: exactMatch.id, workspaceName: exactMatch.name }
        }

        // Partial case-insensitive name match
        const partialMatches = workspaces.filter((w) => w.name.toLowerCase().includes(searchTerm))

        const singleMatch = partialMatches.length === 1 ? partialMatches[0] : undefined
        if (singleMatch) {
            return { workspaceId: singleMatch.id, workspaceName: singleMatch.name }
        }

        if (partialMatches.length > 1) {
            const listed = partialMatches
                .slice(0, 5)
                .map((w) => `  - "${w.name}" (id: ${w.id})`)
                .join('\n')
            throw new Error(
                `Ambiguous workspace reference "${trimmed}". Multiple workspaces match:\n${listed}` +
                    (partialMatches.length > 5
                        ? `\n  ... and ${partialMatches.length - 5} more`
                        : ''),
            )
        }

        // No match
        throw new Error(
            `Workspace "${trimmed}" not found. Use list-workspaces to see available workspaces.`,
        )
    }

    /**
     * Clear all client caches and detach pending requests — useful for testing.
     */
    clearCache(): void {
        this.stateByClient = new WeakMap()
    }
}

// Export singleton instance
export const workspaceResolver = new WorkspaceResolver()
