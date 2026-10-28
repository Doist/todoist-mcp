import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { mapComment } from '../tool-helpers.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { CommentSchema as CommentOutputSchema, FailureSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const CommentUpdateSchema = z.object({
    id: z.string().min(1).describe('The ID of the comment to update.'),
    content: z.string().min(1).describe('The new content for the comment.'),
})

const ArgsSchema = {
    comments: z.array(CommentUpdateSchema).min(1).describe('The comments to update.'),
}

const OutputSchema = {
    comments: z.array(CommentOutputSchema).describe('The updated comments.'),
    totalCount: z.number().describe('The total number of comments updated.'),
    updatedCommentIds: z.array(z.string()).describe('The IDs of the updated comments.'),
    failures: z
        .array(FailureSchema)
        .describe('Comments that could not be updated, with the reason for each.'),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('The number of comments updated.'),
            failureCount: z.number(),
        })
        .describe('Summary of operations performed.'),
}

const updateComments = {
    name: ToolNames.UPDATE_COMMENTS,
    description: 'Update multiple existing comments with new content.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        const { comments } = args

        // Each comment is updated independently, so one rejection neither discards the
        // comments that were updated nor hides them behind one error.
        const settled = await Promise.allSettled(
            comments.map((comment) =>
                executeWithRetry(() =>
                    client.updateComment(comment.id, { content: comment.content }),
                ),
            ),
        )

        const mappedComments: ReturnType<typeof mapComment>[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                mappedComments.push(mapComment(result.value))
            } else {
                failures.push({
                    item: comments[index]?.id ?? `Comment ${index + 1}`,
                    error: formatBatchItemError(result.reason),
                })
            }
        })

        logBatchFailures(ToolNames.UPDATE_COMMENTS, comments.length, failures)

        const textContent = appendFailureSummary(
            generateTextContent({ comments: mappedComments }),
            failures,
        )

        return {
            textContent,
            structuredContent: {
                comments: mappedComments,
                totalCount: mappedComments.length,
                updatedCommentIds: mappedComments.map((comment) => comment.id),
                failures,
                appliedOperations: {
                    updateCount: mappedComments.length,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({ comments }: { comments: ReturnType<typeof mapComment>[] }): string {
    // Group comments by entity type and count
    const taskComments = comments.filter((c) => c.taskId).length
    const projectComments = comments.filter((c) => c.projectId).length

    const parts: string[] = []
    if (taskComments > 0) {
        const commentsLabel = taskComments > 1 ? 'comments' : 'comment'
        parts.push(`${taskComments} task ${commentsLabel}`)
    }
    if (projectComments > 0) {
        const commentsLabel = projectComments > 1 ? 'comments' : 'comment'
        parts.push(`${projectComments} project ${commentsLabel}`)
    }
    const summary = parts.length > 0 ? `Updated ${parts.join(' and ')}` : 'No comments updated'

    return summary
}

export { updateComments }
