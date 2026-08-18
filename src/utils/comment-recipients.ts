import type { Comment, GetTaskCommentsArgs, TodoistApi } from '@doist/todoist-sdk'

/** Value that tells `add-comments` to post without notifying anyone. */
export const NO_NOTIFY_KEYWORD = 'none'

export type CommentTarget =
    | { taskId: string; projectId?: never }
    | { projectId: string; taskId?: never }

/** Whether a `notifyUsers` list is the explicit "notify nobody" opt-out. */
export function isNoNotifyList(notifyUsers: string[]): boolean {
    return notifyUsers.length === 1 && notifyUsers[0]?.trim().toLowerCase() === NO_NOTIFY_KEYWORD
}

/**
 * Work out who Todoist's own clients would notify about a new comment.
 *
 * The API notifies exactly the people it is handed and derives nobody itself,
 * so a comment posted without recipients notifies no one — and, because a reply
 * takes its recipients from the comment before it, silences the next comment in
 * the thread too. Mirroring the clients here keeps that chain intact:
 *
 * - replying to an existing thread notifies the previous comment's participants
 * - the first comment on a task notifies its assignee, assigner and creator
 * - the first comment on a project notifies nobody, as a project has no assignee
 *
 * The comment's own author is never a recipient.
 *
 * @param client - Todoist API client
 * @param target - The task or project being commented on
 * @param currentUserId - The authenticated user, excluded from the result
 * @returns User IDs to notify, deduplicated
 */
export async function getDefaultCommentRecipients(
    client: TodoistApi,
    target: CommentTarget,
    currentUserId: string,
): Promise<string[]> {
    const previousComment = await getLatestComment(client, target)

    if (previousComment) {
        return dedupe(
            [...(previousComment.uidsToNotify ?? []), previousComment.postedUid],
            currentUserId,
        )
    }

    if (!target.taskId) {
        return []
    }

    const task = await client.getTask(target.taskId)
    return dedupe([task.responsibleUid, task.assignedByUid, task.addedByUid], currentUserId)
}

async function getLatestComment(
    client: TodoistApi,
    target: CommentTarget,
): Promise<Comment | undefined> {
    let latest: Comment | undefined
    let cursor: string | null = null

    // Walked a page at a time, keeping only the newest comment seen. A thread
    // can be arbitrarily long and all we want from it is its last participant,
    // so there is no reason to hold the whole history in memory. Page order is
    // not guaranteed, so every page is still compared.
    do {
        const response = await client.getComments({
            ...(target.taskId ? { taskId: target.taskId } : { projectId: target.projectId }),
            cursor,
        } as GetTaskCommentsArgs)

        for (const comment of response.results) {
            if (!latest || comment.postedAt > latest.postedAt) latest = comment
        }
        cursor = response.nextCursor
    } while (cursor)

    return latest
}

function dedupe(userIds: (string | null | undefined)[], currentUserId: string): string[] {
    const seen = new Set<string>()
    for (const userId of userIds) {
        if (userId && userId !== currentUserId) seen.add(userId)
    }
    return [...seen]
}
