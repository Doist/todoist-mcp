import type { AddCommentArgs, TodoistApi } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { isInboxProjectId, mapComment, resolveInboxProjectId } from '../tool-helpers.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import {
    type CommentTarget,
    NO_NOTIFY_KEYWORD,
    getDefaultCommentRecipients,
    isNoNotifyList,
} from '../utils/comment-recipients.js'
import { ApiLimits } from '../utils/constants.js'
import { CommentSchema as CommentOutputSchema, FailureSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeCreateWithRetry, executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'
import { resolveUserRefs, userResolver } from '../utils/user-resolver.js'

const CommentSchema = z.object({
    taskId: z.string().optional().describe('The ID of the task to comment on.'),
    projectId: z
        .string()
        .optional()
        .describe(
            'The ID of the project to comment on. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
    content: z.string().min(1).describe('The content of the comment.'),
    notifyUsers: z
        .array(z.string().min(1))
        .min(1)
        .max(ApiLimits.NOTIFY_USERS_MAX)
        .optional()
        .describe(
            `Who to notify about this comment — a user ID, email, full name, or "me" for each person. Set this whenever the comment mentions someone; the text of an @mention notifies nobody on its own. Omit to notify whoever the Todoist apps would (the task's assignee, assigner and creator on a first comment, or the previous comment's participants on a reply). Pass ["${NO_NOTIFY_KEYWORD}"] to notify nobody.`,
        ),
})

const ArgsSchema = {
    comments: z.array(CommentSchema).min(1).describe('The array of comments to add.'),
}

const OutputSchema = {
    comments: z.array(CommentOutputSchema).describe('The created comments.'),
    totalCount: z.number().describe('The total number of comments created.'),
    addedCommentIds: z.array(z.string()).describe('The IDs of the added comments.'),
    failures: z
        .array(FailureSchema)
        .describe(
            'Comments that could not be added, identified by their content, with the reason for each.',
        ),
    totalRequested: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
}

type CommentInput = z.infer<typeof CommentSchema>
type TodoistUser = Awaited<ReturnType<TodoistApi['getUser']>>

const addComments = {
    name: ToolNames.ADD_COMMENTS,
    description:
        'Add multiple comments to tasks or projects, optionally notifying collaborators. Each comment must specify either taskId or projectId.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    // Open world: a comment notifies other people.
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
    async execute(args, client) {
        const { comments } = args

        // The current user is needed to resolve "inbox" and to keep the author out of
        // their own comment's recipients. Fetched at most once, and only if a comment
        // needs it, so a failed lookup fails just those comments.
        let currentUser: Promise<TodoistUser> | undefined
        const getCurrentUser = () => (currentUser ??= executeWithRetry(() => client.getUser()))

        // Two comments on the same target within one call are a single conversation,
        // so they notify the same people: each target's thread is read only once.
        const defaultRecipientsByTarget = new Map<string, Promise<string[]>>()

        async function resolveRecipients(
            { notifyUsers }: CommentInput,
            target: CommentTarget,
        ): Promise<string[]> {
            if (notifyUsers) {
                if (isNoNotifyList(notifyUsers)) return []
                const resolved = await executeWithRetry(() => resolveUserRefs(client, notifyUsers))
                return resolved.map((user) => user.userId)
            }

            const { id: currentUserId } = await getCurrentUser()
            const key = target.taskId ? `task:${target.taskId}` : `project:${target.projectId}`
            let pending = defaultRecipientsByTarget.get(key)
            if (!pending) {
                pending = getDefaultCommentRecipients(client, target, currentUserId)
                defaultRecipientsByTarget.set(key, pending)
            }
            return await pending
        }

        // Every comment's target and recipients are resolved before any is posted, so
        // reading a thread for its default recipients never sees this batch's comments.
        const prepared = await Promise.allSettled(
            comments.map(async (comment) => {
                const target = await resolveTarget(comment, getCurrentUser)
                const uidsToNotify = await resolveRecipients(comment, target)
                return { target, uidsToNotify }
            }),
        )

        // Each comment is added independently: one bad target must not hide the
        // comments that were posted, or a retry of the whole batch would post them twice.
        const settled = await Promise.allSettled(
            prepared.map((preparation, index) => {
                if (preparation.status === 'rejected') {
                    return Promise.reject(preparation.reason)
                }
                const { target, uidsToNotify } = preparation.value
                return executeCreateWithRetry(() =>
                    client.addComment({
                        content: comments[index]?.content,
                        ...target,
                        // Nobody to notify means no recipient field at all,
                        // rather than an empty one.
                        ...(uidsToNotify.length > 0 && { uidsToNotify }),
                    } as AddCommentArgs),
                )
            }),
        )

        const mappedComments: ReturnType<typeof mapComment>[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                mappedComments.push(mapComment(result.value))
            } else {
                failures.push({
                    item: comments[index]?.content ?? `Comment ${index + 1}`,
                    error: formatBatchItemError(result.reason),
                })
            }
        })

        logBatchFailures(ToolNames.ADD_COMMENTS, comments.length, failures, { redactItems: true })

        const notifiedNames = await getNotifiedNames(client, mappedComments)
        const textContent = appendFailureSummary(
            generateTextContent({ comments: mappedComments, notifiedNames }),
            failures,
        )

        return {
            textContent,
            structuredContent: {
                comments: mappedComments,
                totalCount: mappedComments.length,
                addedCommentIds: mappedComments.map((comment) => comment.id),
                failures,
                totalRequested: comments.length,
                successCount: mappedComments.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

/**
 * Work out what a comment is posted on, resolving "inbox" to the user's inbox project.
 *
 * @throws Error when the comment names neither or both of taskId and projectId
 */
async function resolveTarget(
    comment: CommentInput,
    getCurrentUser: () => Promise<TodoistUser>,
): Promise<CommentTarget> {
    if (!comment.taskId && !comment.projectId) {
        throw new Error('Either taskId or projectId must be provided.')
    }
    if (comment.taskId && comment.projectId) {
        throw new Error('Cannot provide both taskId and projectId. Choose one.')
    }
    if (comment.taskId) {
        return { taskId: comment.taskId }
    }

    const projectId = await resolveInboxProjectId({
        projectId: comment.projectId,
        user: isInboxProjectId(comment.projectId) ? await getCurrentUser() : undefined,
    })
    return { projectId } as CommentTarget
}

/**
 * Short names for everyone the posted comments notified, from the collaborators
 * of each comment's project. Naming people is a nicety: a failed lookup leaves
 * them shown by user ID rather than failing comments that were already posted.
 */
async function getNotifiedNames(
    client: TodoistApi,
    comments: ReturnType<typeof mapComment>[],
): Promise<ReadonlyMap<string, string>> {
    // A task comment carries no project, so each task is read once to find it.
    const projectIdsByTask = new Map<string, Promise<string>>()
    function getTaskProjectId(taskId: string): Promise<string> {
        let projectId = projectIdsByTask.get(taskId)
        if (!projectId) {
            projectId = executeWithRetry(() => client.getTask(taskId)).then(
                (task) => task.projectId,
            )
            projectIdsByTask.set(taskId, projectId)
        }
        return projectId
    }

    try {
        const projectIds = await Promise.all(
            comments
                .filter((comment) => comment.notifiedUserIds)
                .flatMap(({ projectId, taskId }): (string | Promise<string>)[] => {
                    if (projectId) return [projectId]
                    return taskId ? [getTaskProjectId(taskId)] : []
                }),
        )
        return await userResolver.getUserShortNames(client, projectIds)
    } catch {
        return new Map()
    }
}

function generateTextContent({
    comments,
    notifiedNames,
}: {
    comments: ReturnType<typeof mapComment>[]
    notifiedNames: ReadonlyMap<string, string>
}): string {
    // Group comments by entity type and count
    const taskComments = comments.filter((c) => c.taskId).length
    const projectComments = comments.filter((c) => c.projectId).length

    // Generate summary text
    const parts: string[] = []
    if (taskComments > 0) {
        const commentsLabel = taskComments > 1 ? 'comments' : 'comment'
        parts.push(`${taskComments} task ${commentsLabel}`)
    }
    if (projectComments > 0) {
        const commentsLabel = projectComments > 1 ? 'comments' : 'comment'
        parts.push(`${projectComments} project ${commentsLabel}`)
    }
    const summary = parts.length > 0 ? `Added ${parts.join(' and ')}` : 'No comments added'

    const notified = [...new Set(comments.flatMap((c) => c.notifiedUserIds ?? []))]
    if (notified.length === 0) {
        return summary
    }
    return `${summary}. Notified: ${notified.map((id) => notifiedNames.get(id) ?? id).join(', ')}`
}

export { addComments }
