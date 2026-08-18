import type {
    Comment,
    GetCommentsResponse,
    GetTaskCommentsArgs,
    TodoistApi,
} from '@doist/todoist-sdk'
import { fetchAllPages } from '../tool-helpers.js'

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
    // The SDK brands the unused key as `never` on each half of
    // `GetTaskCommentsArgs | GetProjectCommentsArgs`, which a generic cannot
    // infer across, so pin one half and let the target supply either key.
    const comments = await fetchAllPages<GetTaskCommentsArgs, GetCommentsResponse, Comment>({
        apiMethod: (args) => client.getComments(args),
        args: target as GetTaskCommentsArgs,
    })

    // The API does not guarantee an order, so pick the newest explicitly.
    return comments.reduce<Comment | undefined>(
        (latest, comment) => (!latest || comment.postedAt > latest.postedAt ? comment : latest),
        undefined,
    )
}

function dedupe(userIds: (string | null | undefined)[], currentUserId: string): string[] {
    const seen = new Set<string>()
    for (const userId of userIds) {
        if (userId && userId !== currentUserId) seen.add(userId)
    }
    return [...seen]
}
