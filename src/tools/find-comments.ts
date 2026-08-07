import type { Comment } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapComment, resolveInboxProjectId } from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { CommentSchema as CommentOutputSchema } from '../utils/output-schemas.js'
import { formatNextSteps } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    taskId: z.string().optional().describe('Find comments for a specific task.'),
    projectId: z
        .string()
        .optional()
        .describe(
            'Find comments for a specific project. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
    commentId: z.string().optional().describe('Get a specific comment by ID.'),
    cursor: z.string().optional().describe('Pagination cursor for retrieving more results.'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(ApiLimits.COMMENTS_MAX)
        .optional()
        .describe('Maximum number of comments to return'),
}

const OutputSchema = {
    comments: z.array(CommentOutputSchema).describe('The found comments.'),
    searchType: z
        .string()
        .describe(
            'The type of search performed: "single" (comment ID), "task" (task ID), or "project" (project ID).',
        ),
    searchId: z.string().describe('The ID that was searched for (comment, task, or project ID).'),
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
    totalCount: z.number().describe('The total number of comments in this page.'),
}

const findComments = {
    name: ToolNames.FIND_COMMENTS,
    description:
        'Find comments by task, project, or get a specific comment by ID. Exactly one of taskId, projectId, or commentId must be provided.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        // Validate that exactly one search parameter is provided
        const searchParams = [args.taskId, args.projectId, args.commentId].filter(Boolean)
        if (searchParams.length === 0) {
            throw new Error('Must provide exactly one of: taskId, projectId, or commentId.')
        }
        if (searchParams.length > 1) {
            throw new Error(
                'Cannot provide multiple search parameters. Choose one of: taskId, projectId, or commentId.',
            )
        }

        // Resolve "inbox" to actual inbox project ID if needed
        const resolvedProjectId = await resolveInboxProjectId({
            projectId: args.projectId,
            client,
        })

        let hasMore = false
        let nextCursor: string | null = null
        let rawComments: Comment[]

        if (args.commentId) {
            // Get single comment
            const comment = await client.getComment(args.commentId)
            rawComments = [comment]
        } else if (args.taskId) {
            // Get comments by task
            const response = await client.getComments({
                taskId: args.taskId,
                cursor: args.cursor || null,
                limit: args.limit || ApiLimits.COMMENTS_DEFAULT,
            })
            rawComments = response.results
            hasMore = response.nextCursor !== null
            nextCursor = response.nextCursor
        } else if (resolvedProjectId) {
            // Get comments by project
            const response = await client.getComments({
                projectId: resolvedProjectId,
                cursor: args.cursor || null,
                limit: args.limit || ApiLimits.COMMENTS_DEFAULT,
            })
            rawComments = response.results
            hasMore = response.nextCursor !== null
            nextCursor = response.nextCursor
        } else {
            // This should never happen due to validation, but TypeScript needs it
            throw new Error('Invalid state: no search parameter provided')
        }

        const comments = rawComments.map(mapComment)

        const textContent = generateTextContent({
            comments,
            searchType: args.commentId ? 'single' : args.taskId ? 'task' : 'project',
            searchId: args.commentId || args.taskId || args.projectId || '',
            hasMore,
            nextCursor,
        })

        return {
            textContent,
            structuredContent: {
                comments,
                searchType: args.commentId ? 'single' : args.taskId ? 'task' : 'project',
                searchId: args.commentId || args.taskId || args.projectId || '',
                hasMore,
                nextCursor: nextCursor ?? undefined,
                totalCount: comments.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    comments,
    searchType,
    searchId,
    hasMore,
    nextCursor,
}: {
    comments: ReturnType<typeof mapComment>[]
    searchType: 'single' | 'task' | 'project'
    searchId: string
    hasMore: boolean
    nextCursor: string | null
}): string {
    if (comments.length === 0) {
        return `No comments found for ${searchType}${searchType !== 'single' ? ` ${searchId}` : ''}`
    }

    // Build summary
    let summary: string
    if (searchType === 'single') {
        const comment = comments[0]
        if (!comment) {
            return 'Comment not found'
        }
        const hasAttachment = comment.fileAttachment !== undefined
        const attachmentInfo = hasAttachment
            ? ` • Has attachment: ${comment.fileAttachment?.fileName || 'file'}`
            : ''
        summary = `Found comment${attachmentInfo} • id=${comment.id}`
    } else {
        const attachmentCount = comments.filter((c) => c.fileAttachment !== undefined).length
        const attachmentInfo = attachmentCount > 0 ? ` (${attachmentCount} with attachments)` : ''
        const commentsLabel = comments.length === 1 ? 'comment' : 'comments'
        summary = `Found ${comments.length} ${commentsLabel} for ${searchType} ${searchId}${attachmentInfo}`

        if (hasMore) {
            summary += ' • More available'
        }
    }

    // Only show pagination next step if there's a cursor
    if (nextCursor) {
        const next = formatNextSteps([], nextCursor)
        return `${summary}\n${next}`
    }

    return summary
}

export { findComments }
