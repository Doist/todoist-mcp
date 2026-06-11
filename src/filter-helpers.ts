import type { TodoistApi } from '@doist/todoist-sdk'
import { resolveUserNameToId } from './utils/user-resolver.js'

export const RESPONSIBLE_USER_FILTERING = ['assigned', 'unassignedOrMe', 'all'] as const
export type ResponsibleUserFiltering = (typeof RESPONSIBLE_USER_FILTERING)[number]

/**
 * Resolves a responsible user name/email to user ID and email.
 * @param client - Todoist API client
 * @param responsibleUser - User identifier (can be user ID, name, or email)
 * @returns Object with userId and email, or undefined if not provided
 * @throws Error if user cannot be found
 */
export async function resolveResponsibleUser(
    client: TodoistApi,
    responsibleUser: string | undefined,
): Promise<{ userId: string; email: string | undefined } | undefined> {
    if (!responsibleUser) {
        return undefined
    }

    const resolved = await resolveUserNameToId(client, responsibleUser)
    if (!resolved) {
        throw new Error(
            `Could not find user: "${responsibleUser}". Make sure the user is a collaborator on a shared project.`,
        )
    }

    return { userId: resolved.userId, email: resolved.email ?? undefined }
}

/**
 * Appends a filter component to a query string with proper ' & ' separator.
 * @param query - The existing query string
 * @param filterComponent - The filter component to append
 * @returns The updated query string
 */
export function appendToQuery(query: string, filterComponent: string): string {
    if (filterComponent.length === 0) {
        return query
    }
    if (query.length === 0) {
        return filterComponent
    }
    return `${query} & ${filterComponent}`
}

/**
 * Builds a query filter string for responsible user filtering that can be appended to a Todoist filter query.
 * @param resolvedAssigneeId - The resolved assignee ID (if provided)
 * @param assigneeEmail - The assignee email (if provided)
 * @param responsibleUserFiltering - The filtering mode ('assigned', 'unassignedOrMe', 'all')
 * @returns Query filter string (e.g., "assigned to: email@example.com" or "!assigned to: others")
 */
export function buildResponsibleUserQueryFilter({
    resolvedAssigneeId,
    assigneeEmail,
    responsibleUserFiltering = 'unassignedOrMe',
}: {
    resolvedAssigneeId: string | undefined
    assigneeEmail: string | undefined
    responsibleUserFiltering?: ResponsibleUserFiltering
}): string {
    if (resolvedAssigneeId && assigneeEmail) {
        // If specific user is provided, filter by that user
        return `assigned to: ${assigneeEmail}`
    }

    // Otherwise use the filtering mode
    if (responsibleUserFiltering === 'unassignedOrMe') {
        // Exclude tasks assigned to others (keeps unassigned + assigned to me)
        return '!assigned to: others'
    }

    if (responsibleUserFiltering === 'assigned') {
        // Only tasks assigned to others
        return 'assigned to: others'
    }

    // For 'all', don't add any assignment filter
    return ''
}

/**
 * Filters tasks based on responsible user logic:
 * - If resolvedAssigneeId is provided: returns only tasks assigned to that user
 * - If no resolvedAssigneeId: returns only unassigned tasks or tasks assigned to current user
 * @param tasks - Array of tasks to filter (must have responsibleUid property)
 * @param resolvedAssigneeId - The resolved assignee ID to filter by (optional)
 * @param currentUserId - The current authenticated user's ID
 * @returns Filtered array of tasks
 */
export function filterTasksByResponsibleUser<T extends { responsibleUid?: string }>({
    tasks,
    resolvedAssigneeId,
    currentUserId,
    responsibleUserFiltering = 'unassignedOrMe',
}: {
    tasks: T[]
    resolvedAssigneeId: string | undefined
    currentUserId: string
    responsibleUserFiltering?: ResponsibleUserFiltering
}): T[] {
    if (resolvedAssigneeId) {
        // If responsibleUser provided, only return tasks assigned to that user
        return tasks.filter((task) => task.responsibleUid === resolvedAssigneeId)
    } else if (responsibleUserFiltering === 'unassignedOrMe') {
        return tasks.filter((task) => !task.responsibleUid || task.responsibleUid === currentUserId)
    } else if (responsibleUserFiltering === 'assigned') {
        return tasks.filter((task) => task.responsibleUid && task.responsibleUid !== currentUserId)
    } else {
        return tasks
    }
}
