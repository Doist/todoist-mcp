import type { AddCommentArgs } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { isInboxProjectId, mapComment, resolveInboxProjectId } from '../tool-helpers.js'
import { CommentSchema as CommentOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const CommentSchema = z
    .object({
        taskId: z.string().optional().describe('The ID of the task to comment on.'),
        projectId: z
            .string()
            .optional()
            .describe(
                'The ID of the project to comment on. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
            ),
        content: z.string().min(1).describe('The content of the comment.'),
        fileData: z
            .string()
            .optional()
            .describe('Base64-encoded file content to attach to the comment.'),
        fileName: z
            .string()
            .optional()
            .describe('Name of the file (required when fileData is provided).'),
        fileType: z
            .string()
            .optional()
            .describe('MIME type of the file (e.g., "application/pdf", "image/png").'),
    })
    .refine(
        (data) => {
            // If fileData is provided, fileName is required
            return !data.fileData || data.fileName
        },
        {
            message: 'fileName is required when fileData is provided',
        },
    )

const ArgsSchema = {
    comments: z.array(CommentSchema).min(1).describe('The array of comments to add.'),
}

const OutputSchema = {
    comments: z.array(CommentOutputSchema).describe('The created comments.'),
    totalCount: z.number().describe('The total number of comments created.'),
    addedCommentIds: z.array(z.string()).describe('The IDs of the added comments.'),
}

const addComments = {
    name: ToolNames.ADD_COMMENTS,
    description:
        'Add multiple comments to tasks or projects. Each comment must specify either taskId or projectId. Optionally attach files by providing base64-encoded fileData and fileName.',
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

        // Check if any comment needs inbox resolution
        const needsInboxResolution = comments.some((comment) => isInboxProjectId(comment.projectId))
        const todoistUser = needsInboxResolution ? await client.getUser() : undefined

        const addCommentPromises = comments.map(
            async ({ content, taskId, projectId, fileData, fileName, fileType }) => {
                // Resolve "inbox" to actual inbox project ID if needed
                const resolvedProjectId = await resolveInboxProjectId({
                    projectId,
                    user: todoistUser,
                    client: todoistUser ? undefined : client,
                })

                let attachment = null

                // Handle file upload if file data is provided
                if (fileData && fileName) {
                    try {
                        const buffer = Buffer.from(fileData, 'base64')
                        const uploadResult = await client.uploadFile({
                            file: buffer,
                            fileName: fileName,
                            projectId: resolvedProjectId || undefined,
                        })

                        attachment = {
                            fileUrl: uploadResult.fileUrl || '',
                            fileName: uploadResult.fileName || fileName,
                            fileType: fileType || uploadResult.fileType || undefined,
                            resourceType: uploadResult.resourceType || 'file',
                        }
                    } catch (error) {
                        throw new Error(
                            `Failed to upload file "${fileName}": ${error instanceof Error ? error.message : String(error)}`,
                        )
                    }
                }

                return await client.addComment({
                    content,
                    ...(taskId ? { taskId } : { projectId: resolvedProjectId }),
                    ...(attachment ? { attachment } : {}),
                } as AddCommentArgs)
            },
        )

        const newComments = await Promise.all(addCommentPromises)
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

function generateTextContent({ comments }: { comments: ReturnType<typeof mapComment>[] }): string {
    // Group comments by entity type and count
    const taskComments = comments.filter((c) => c.taskId).length
    const projectComments = comments.filter((c) => c.projectId).length
    const attachmentCount = comments.filter((c) => c.fileAttachment).length

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

    let summary = parts.length > 0 ? `Added ${parts.join(' and ')}` : 'No comments added'

    // Add attachment information
    if (attachmentCount > 0) {
        summary += ` (${attachmentCount} with an attachment)`
    }

    return summary
}

export { addComments }
