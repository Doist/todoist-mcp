import {
    isPersonalProject,
    isWorkspaceProject,
    type ActivityEvent,
    type ColorKey,
    type Comment,
    type CurrentUser,
    type Label,
    type MoveTaskArgs,
    type PersonalProject,
    type Reminder,
    type Section,
    type Task,
    type TodoistApi,
    type WorkspaceProject,
} from '@doist/todoist-sdk'
import z from 'zod'
import { ApiLimits } from './utils/constants.js'
import { formatDuration } from './utils/duration-parser.js'
import { convertNumberToPriority } from './utils/priorities.js'

// Re-export filter helpers for backward compatibility
export {
    appendToQuery,
    buildResponsibleUserQueryFilter,
    filterTasksByResponsibleUser,
    RESPONSIBLE_USER_FILTERING,
    type ResponsibleUserFiltering,
    resolveResponsibleUser,
} from './filter-helpers.js'

export type Project = PersonalProject | WorkspaceProject
export { isPersonalProject, isWorkspaceProject }

/**
 * Checks if a project ID represents the inbox (case-insensitive).
 *
 * @param projectId - The project ID to check
 * @returns true if the project ID is inbox-like
 */
export function isInboxProjectId(projectId: string | undefined): boolean {
    return projectId?.toLowerCase() === 'inbox'
}

/**
 * Resolves "inbox" project ID to actual inbox project ID (case-insensitive).
 * Only makes API calls when necessary (when projectId is inbox-like and user not provided).
 *
 * @param args - Configuration object
 * @param args.projectId - The project ID to resolve (may be "inbox", "Inbox", etc.)
 * @param args.user - The current user object (if already fetched)
 * @param args.client - The API client (if user needs to be fetched)
 * @returns Promise resolving to the resolved project ID
 */
export async function resolveInboxProjectId(args: {
    projectId: string | undefined
    user?: CurrentUser
    client?: TodoistApi
}): Promise<string | undefined> {
    const { projectId, user, client } = args

    // If not inbox-like, return immediately (no API call needed)
    if (!isInboxProjectId(projectId)) {
        return projectId
    }

    // It's inbox-like, so we need the user
    const currentUser = user || (client ? await client.getUser() : null)

    if (!currentUser) {
        throw new Error('Either user or client must be provided when resolving inbox project ID')
    }

    return currentUser.inboxProjectId
}

/**
 * Generic pagination utility for Todoist API methods
 *
 * Recursively fetches all pages of data from paginated Todoist API endpoints.
 *
 * @template TArgs - The type of arguments accepted by the API method
 * @template TResponse - The type of response returned by the API method
 * @template TResult - The type of individual result items in the response
 *
 * @param options - Configuration options
 * @param options.apiMethod - The Todoist API method to call (e.g., todoistApi.getLabels)
 * @param options.args - Initial arguments to pass to the API method (excluding cursor and limit)
 * @param options.limit - Number of items to fetch per page (default: 100)
 * @returns Promise resolving to an array of all result items across all pages
 *
 * @example
 * const allLabels = await fetchAllPages({
 *   apiMethod: (args) => todoistApi.getLabels(args),
 *   args: {},
 *   limit: 100
 * })
 */
export async function fetchAllPages<
    TArgs extends { cursor?: string | null; limit?: number },
    TResponse extends { results: TResult[]; nextCursor: string | null },
    TResult,
>(options: {
    apiMethod: (args: TArgs) => Promise<TResponse>
    args?: Omit<TArgs, 'cursor' | 'limit'>
    limit?: number
}): Promise<TResult[]> {
    const { apiMethod, args, limit = 100 } = options
    const allResults: TResult[] = []
    let cursor: string | null = null

    // Keep fetching pages until there's no nextCursor
    do {
        const response = await apiMethod({
            ...args,
            cursor,
            limit,
        } as TArgs)

        allResults.push(...response.results)
        cursor = response.nextCursor ?? null
    } while (cursor !== null)

    return allResults
}

/**
 * Wraps a search query with wildcards for substring matching.
 * If the query already contains unescaped wildcards, it is returned as-is
 * to preserve intentional wildcard patterns (e.g. prefix matching with "work*").
 */
export function toWildcardQuery(query: string): string {
    // Unescaped wildcard = `*` preceded by an even number of backslashes (including zero)
    if (/(?<!\\)(?:\\\\)*\*/.test(query)) {
        return query
    }
    // Only escape backslashes not followed by `*` to preserve literal asterisks (\*)
    const escaped = query.replaceAll(/\\(?!\*)/g, '\\\\')
    return `*${escaped}*`
}

/**
 * Searches projects by name and fetches all matching pages.
 *
 * @param client - The Todoist API client
 * @param query - The search query string
 * @returns Promise resolving to array of matching projects
 */
export async function searchAllProjects(client: TodoistApi, query: string): Promise<Project[]> {
    return fetchAllPages({
        apiMethod: client.searchProjects.bind(client),
        args: { query: toWildcardQuery(query) },
        limit: ApiLimits.PROJECTS_MAX,
    })
}

/**
 * Fetches all active (non-archived) projects across every page.
 *
 * @param client - The Todoist API client
 * @returns Promise resolving to array of active projects
 */
export async function fetchAllActiveProjects(client: TodoistApi): Promise<Project[]> {
    return fetchAllPages({
        apiMethod: client.getProjects.bind(client),
        args: {},
        limit: ApiLimits.PROJECTS_MAX,
    })
}

/**
 * Fetches all archived projects across every page.
 *
 * The API has no server-side search for archived projects, so callers that need
 * to filter by name should fetch all and filter client-side with
 * {@link matchesWildcardQuery}.
 *
 * @param client - The Todoist API client
 * @returns Promise resolving to array of archived projects
 */
export async function fetchAllArchivedProjects(client: TodoistApi): Promise<Project[]> {
    return fetchAllPages({
        apiMethod: client.getArchivedProjects.bind(client),
        args: {},
        limit: ApiLimits.PROJECTS_MAX,
    })
}

/**
 * Compiles a search query into a case-insensitive RegExp using the same wildcard
 * semantics as server-side search (see {@link toWildcardQuery}): `*` matches any
 * sequence, `\*` is a literal asterisk, and every other character (backslashes
 * included) is matched literally. A query without an unescaped `*` matches as a
 * substring; otherwise the whole name must match.
 *
 * Compile once and reuse the result when filtering many names (e.g. archived
 * projects), rather than calling {@link matchesWildcardQuery} per item.
 */
export function compileWildcardQuery(query: string): RegExp {
    const escapeRegex = (char: string) => char.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Unescaped wildcard = `*` preceded by an even number of backslashes
    const hasWildcard = /(?<!\\)(?:\\\\)*\*/.test(query)
    const chars = [...query]
    let pattern = ''
    for (let i = 0; i < chars.length; i++) {
        const char = chars[i] as string
        if (char === '\\' && chars[i + 1] === '\\') {
            pattern += '\\\\' // escaped backslash → literal backslash
            i++
        } else if (char === '\\' && chars[i + 1] === '*') {
            pattern += '\\*' // escaped asterisk → literal asterisk
            i++
        } else if (char === '*') {
            pattern += '.*' // wildcard
        } else {
            pattern += escapeRegex(char)
        }
    }
    // No wildcard → substring (unanchored) match; wildcard → match the whole name.
    return new RegExp(hasWildcard ? `^${pattern}$` : pattern, 'iu')
}

/**
 * Tests whether a name matches a search query using the same wildcard semantics
 * as server-side search. Used for client-side filtering where the API exposes no
 * search endpoint (e.g. archived projects). For bulk filtering, prefer
 * {@link compileWildcardQuery} so the pattern is compiled only once.
 */
export function matchesWildcardQuery(name: string, query: string): boolean {
    return compileWildcardQuery(query).test(name)
}

/**
 * Searches labels by name and fetches all matching pages.
 *
 * @param client - The Todoist API client
 * @param query - The search query string
 * @returns Promise resolving to array of matching labels
 */
export async function searchAllLabels(client: TodoistApi, query: string): Promise<Label[]> {
    return fetchAllPages({
        apiMethod: client.searchLabels.bind(client),
        args: { query: toWildcardQuery(query) },
        limit: ApiLimits.LABELS_MAX,
    })
}

export async function fetchAllSharedLabels(client: TodoistApi): Promise<string[]> {
    return fetchAllPages({
        apiMethod: client.getSharedLabels.bind(client),
        args: {},
        limit: ApiLimits.LABELS_MAX,
    })
}

/**
 * Searches sections by name (optionally scoped to a project) and fetches all matching pages.
 *
 * @param client - The Todoist API client
 * @param query - The search query string
 * @param projectId - Optional project ID to scope the search
 * @returns Promise resolving to array of matching sections
 */
export async function searchAllSections(
    client: TodoistApi,
    query: string,
    projectId?: string,
): Promise<Section[]> {
    const wildcardQuery = toWildcardQuery(query)
    return fetchAllPages({
        apiMethod: client.searchSections.bind(client),
        args: projectId ? { query: wildcardQuery, projectId } : { query: wildcardQuery },
        limit: ApiLimits.SECTIONS_MAX,
    })
}

/**
 * Creates a MoveTaskArgs object from move parameters, validating that exactly one is provided.
 * @param taskId - The task ID (used for error messages)
 * @param projectId - Optional project ID to move to
 * @param sectionId - Optional section ID to move to
 * @param parentId - Optional parent ID to move to
 * @returns MoveTaskArgs object with exactly one destination
 * @throws Error if multiple move parameters are provided or none are provided
 */
export function createMoveTaskArgs(
    taskId: string,
    projectId?: string,
    sectionId?: string,
    parentId?: string,
): MoveTaskArgs {
    // Validate that only one move parameter is provided (RequireExactlyOne constraint)
    const moveParams = [projectId, sectionId, parentId].filter(Boolean)
    if (moveParams.length > 1) {
        throw new Error(
            `Task ${taskId}: Only one of projectId, sectionId, or parentId can be specified at a time. The Todoist API requires exactly one destination for move operations.`,
        )
    }

    if (moveParams.length === 0) {
        throw new Error(
            `Task ${taskId}: At least one of projectId, sectionId, or parentId must be provided for move operations.`,
        )
    }

    // Build moveArgs with the single defined value
    if (projectId) return { projectId }
    if (sectionId) return { sectionId }
    if (parentId) return { parentId }

    // This should never be reached due to the validation above
    throw new Error('Unexpected error: No valid move parameter found')
}

/**
 * Map a single Todoist task to a more structured format, for LLM consumption.
 * @param task - The task to map.
 * @returns The mapped task.
 */
function mapTask(task: Task) {
    return {
        id: task.id,
        content: task.content,
        description: task.description,
        dueDate: task.due?.date,
        recurring: task.due?.isRecurring && task.due.string ? task.due.string : false,
        deadlineDate: task.deadline?.date,
        priority: convertNumberToPriority(task.priority) ?? 'p4',
        projectId: task.projectId,
        sectionId: task.sectionId ?? undefined,
        parentId: task.parentId ?? undefined,
        labels: task.labels,
        duration: task.duration ? formatDuration(task.duration.amount) : undefined,
        responsibleUid: task.responsibleUid ?? undefined,
        assignedByUid: task.assignedByUid ?? undefined,
        checked: task.checked,
        completedAt: task.completedAt?.toISOString() ?? undefined,
        addedAt: task.addedAt?.toISOString() ?? undefined,
    }
}

type MappedTask = ReturnType<typeof mapTask>

/**
 * Map a single Todoist project to a more structured format, for LLM consumption.
 * @param project - The project to map.
 * @returns The mapped project.
 */
function mapProject(project: Project) {
    return {
        id: project.id,
        name: project.name,
        description: project.description,
        color: project.color as ColorKey,
        isFavorite: project.isFavorite,
        isShared: project.isShared,
        parentId: isPersonalProject(project) ? (project.parentId ?? undefined) : undefined,
        inboxProject: isPersonalProject(project) ? (project.inboxProject ?? false) : false,
        viewStyle: project.viewStyle,
        workspaceId: isWorkspaceProject(project) ? project.workspaceId : undefined,
        folderId: isWorkspaceProject(project) ? (project.folderId ?? undefined) : undefined,
        childOrder: project.childOrder,
        isArchived: project.isArchived,
    }
}

/**
 * Map a single Todoist comment to a more structured format, for LLM consumption.
 * @param comment - The comment to map.
 * @returns The mapped comment.
 */
function mapComment(comment: Comment) {
    return {
        id: comment.id,
        taskId: comment.taskId ?? undefined,
        projectId: comment.projectId ?? undefined,
        content: comment.content,
        postedAt: comment.postedAt.toISOString(),
        postedUid: comment.postedUid ?? undefined,
        fileAttachment: comment.fileAttachment
            ? {
                  resourceType: comment.fileAttachment.resourceType,
                  fileName: comment.fileAttachment.fileName ?? undefined,
                  fileSize: comment.fileAttachment.fileSize ?? undefined,
                  fileType: comment.fileAttachment.fileType ?? undefined,
                  fileUrl: comment.fileAttachment.fileUrl ?? undefined,
                  fileDuration: comment.fileAttachment.fileDuration ?? undefined,
                  uploadState: comment.fileAttachment.uploadState ?? undefined,
                  url: comment.fileAttachment.url ?? undefined,
                  title: comment.fileAttachment.title ?? undefined,
                  image: comment.fileAttachment.image ?? undefined,
                  imageWidth: comment.fileAttachment.imageWidth ?? undefined,
                  imageHeight: comment.fileAttachment.imageHeight ?? undefined,
              }
            : undefined,
    }
}

/**
 * Map a single Todoist activity event to a more structured format, for LLM consumption.
 * @param event - The activity event to map.
 * @returns The mapped activity event.
 */
function mapActivityEvent(event: ActivityEvent) {
    return {
        id: event.id ?? undefined,
        objectType: event.objectType,
        objectId: event.objectId,
        eventType: event.eventType,
        eventDate: event.eventDate.toISOString(),
        parentProjectId: event.parentProjectId ?? undefined,
        parentItemId: event.parentItemId ?? undefined,
        initiatorId: event.initiatorId ?? undefined,
        extraData: event.extraData ?? undefined,
    }
}

const ErrorSchema = z.object({
    httpStatusCode: z.number(),
    responseData: z.object({
        error: z.string(),
        errorCode: z.number(),
        errorTag: z.string(),
    }),
})

async function getTasksByFilter({
    client,
    query,
    limit,
    cursor,
}: {
    client: TodoistApi
    query: string
    limit: number | undefined
    cursor: string | undefined
}) {
    try {
        const { results, nextCursor } = await client.getTasksByFilter({ query, cursor, limit })
        const tasks = results.map(mapTask)
        return { tasks, nextCursor }
    } catch (error) {
        const parsedError = ErrorSchema.safeParse(error)
        if (!parsedError.success) {
            throw error
        }
        const { responseData } = parsedError.data
        if (responseData.errorTag === 'INVALID_SEARCH_QUERY') {
            throw new Error(`Invalid filter query: ${query}`)
        }
        throw new Error(
            `${responseData.error} (tag: ${responseData.errorTag}, code: ${responseData.errorCode})`,
        )
    }
}

/**
 * Map a reminder's due date to a flattened output format.
 */
function mapReminderDue(due: {
    isRecurring: boolean
    string: string
    date: string
    datetime?: string | null
    timezone?: string | null
}) {
    return {
        isRecurring: due.isRecurring,
        string: due.string,
        date: due.date,
        datetime: due.datetime ?? undefined,
        timezone: due.timezone ?? undefined,
    }
}

/**
 * Map a single Todoist reminder to a more structured format, for LLM consumption.
 * Normalizes SDK's `itemId` to `taskId` for consistency with other tools.
 * @param reminder - The reminder to map (any of the 3 types).
 * @returns The mapped reminder.
 */
function mapReminder(reminder: Reminder) {
    const base = {
        id: reminder.id,
        taskId: reminder.itemId,
        type: reminder.type,
    }

    switch (reminder.type) {
        case 'relative':
            return {
                ...base,
                minuteOffset: reminder.minuteOffset,
                due: reminder.due ? mapReminderDue(reminder.due) : undefined,
                isUrgent: reminder.isUrgent,
            }
        case 'absolute':
            return {
                ...base,
                due: mapReminderDue(reminder.due),
                isUrgent: reminder.isUrgent,
            }
        case 'location':
            return {
                ...base,
                name: reminder.name,
                locLat: reminder.locLat,
                locLong: reminder.locLong,
                locTrigger: reminder.locTrigger,
                radius: reminder.radius,
            }
    }
}

/**
 * Count reminders by category: time-based (relative/absolute) and location.
 */
function countRemindersByType(reminders: { type: string }[]) {
    const timeBasedCount = reminders.filter(
        (r) => r.type === 'relative' || r.type === 'absolute',
    ).length
    const locationCount = reminders.filter((r) => r.type === 'location').length
    return { timeBasedCount, locationCount }
}

export type { MappedTask }
export {
    countRemindersByType,
    getTasksByFilter,
    mapActivityEvent,
    mapComment,
    mapProject,
    mapReminder,
    mapTask,
}
