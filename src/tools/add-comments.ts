import type { AddCommentArgs, TodoistApi } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { isInboxProjectId, mapComment, resolveInboxProjectId } from '../tool-helpers.js'
import {
    type CommentTarget,
    NO_NOTIFY_KEYWORD,
    getDefaultCommentRecipients,
    isNoNotifyList,
} from '../utils/comment-recipients.js'
import { CommentSchema as CommentOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'
import { resolveUserRefs } from '../utils/user-resolver.js'

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
}

type CommentInput = z.infer<typeof CommentSchema>
type TodoistUser = Awaited<ReturnType<TodoistApi['getUser']>>

const addComments = {
    name: ToolNames.ADD_COMMENTS,
    description:
        'Add multiple comments to tasks or projects, optionally notifying collaborators. Each comment must specify either taskId or projectId.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute(args, client) {
        const { comments } = args

        // Validate each comment
        for (const [index, comment] of comments.entries()) {
            if (!comment.taskId && !comment.projectId) {
                throw new Error(
                    `Comment ${index + 1}: Either taskId or projectId must be provided.`,
                )
            }
            if (comment.taskId && comment.projectId) {
                throw new Error(
                    `Comment ${index + 1}: Cannot provide both taskId and projectId. Choose one.`,
                )
            }
        }

        // Every comment needs the current user, either to resolve "inbox" or to
        // keep the author out of their own comment's recipients.
        const needsInboxResolution = comments.some((comment) => isInboxProjectId(comment.projectId))
        const needsDefaultRecipients = comments.some((comment) => !comment.notifyUsers)
        const todoistUser =
            needsInboxResolution || needsDefaultRecipients ? await client.getUser() : undefined

        const targets = await Promise.all(
            comments.map(async (comment) => {
                // Resolve "inbox" to actual inbox project ID if needed
                const resolvedProjectId = await resolveInboxProjectId({
                    projectId: comment.projectId,
                    user: todoistUser,
                    client: todoistUser ? undefined : client,
                })

                return (
                    comment.taskId ? { taskId: comment.taskId } : { projectId: resolvedProjectId }
                ) as CommentTarget
            }),
        )

        const recipients = await resolveRecipientsPerComment({
            comments,
            targets,
            client,
            currentUser: todoistUser,
        })

        const newComments = await Promise.all(
            comments.map(async ({ content }, index) => {
                const uidsToNotify = recipients[index] ?? []
                return await client.addComment({
                    content,
                    ...targets[index],
                    // Nobody to notify means no recipient field at all,
                    // rather than an empty one.
                    ...(uidsToNotify.length > 0 && { uidsToNotify }),
                } as AddCommentArgs)
            }),
        )

        const mappedComments = newComments.map(mapComment)
        const textContent = generateTextContent({ comments: mappedComments })

        return {
            textContent,
            structuredContent: {
                comments: mappedComments,
                totalCount: mappedComments.length,
                addedCommentIds: mappedComments.map((comment) => comment.id),
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

/**
 * Work out the recipients for every comment in the batch, reading each distinct
 * target's thread only once. Two comments on the same task within one call are
 * a single conversation, so they notify the same people.
 */
async function resolveRecipientsPerComment({
    comments,
    targets,
    client,
    currentUser,
}: {
    comments: CommentInput[]
    targets: CommentTarget[]
    client: TodoistApi
    currentUser: TodoistUser | undefined
}): Promise<string[][]> {
    const byTarget = new Map<string, Promise<string[]>>()

    return await Promise.all(
        comments.map(async ({ notifyUsers }, index) => {
            if (notifyUsers) {
                if (isNoNotifyList(notifyUsers)) return []
                const resolved = await resolveUserRefs(client, notifyUsers)
                return resolved.map((user) => user.userId)
            }

            const target = targets[index]
            if (!target || !currentUser) return []

            const key = target.taskId ? `task:${target.taskId}` : `project:${target.projectId}`
            const pending =
                byTarget.get(key) ?? getDefaultCommentRecipients(client, target, currentUser.id)
            byTarget.set(key, pending)
            return await pending
        }),
    )
}

function generateTextContent({ comments }: { comments: ReturnType<typeof mapComment>[] }): string {
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

    const notified = new Set(comments.flatMap((c) => c.notifiedUserIds ?? []))
    if (notified.size === 0) {
        return summary
    }
    const peopleLabel = notified.size > 1 ? 'people' : 'person'
    return `${summary}. Notified ${notified.size} ${peopleLabel}`
}

export { addComments }
