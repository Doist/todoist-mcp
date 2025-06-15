import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

type TodoistApiInternal = { authToken: string }
type EnrichedComment = Record<string, unknown>

export function registerGetTaskComments(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-task-comments',
        'Get comments from a task in Todoist',
        {
            taskId: z.string(),
            includeFileAttachments: z
                .boolean()
                .optional()
                .describe('Whether to fetch file attachment contents'),
        },
        async ({ taskId, includeFileAttachments = false }) => {
            let response = await api.getComments({ taskId })
            const comments = response.results
            while (response.nextCursor) {
                response = await api.getComments({ taskId, cursor: response.nextCursor })
                comments.push(...response.results)
            }

            if (!includeFileAttachments) {
                return {
                    content: comments.map((comment) => ({
                        type: 'text',
                        text: JSON.stringify(comment, null, 2),
                    })),
                }
            }

            const authToken = (api as unknown as TodoistApiInternal).authToken
            const rawResponse = await fetch(
                `https://api.todoist.com/rest/v2/comments?task_id=${taskId}`,
                {
                    headers: { Authorization: `Bearer ${authToken}` },
                },
            )
            const rawComments = await rawResponse.json()

            const enrichedComments = await Promise.all(
                comments.map(async (comment, index) => {
                    const enrichedComment: EnrichedComment = { ...comment }
                    const rawComment = rawComments[index]

                    if (rawComment?.attachment?.file_url) {
                        const fileResponse = await fetch(rawComment.attachment.file_url, {
                            redirect: 'follow',
                            headers: { Authorization: `Bearer ${authToken}` },
                        })

                        if (fileResponse.ok) {
                            const fileContent = await fileResponse.text()
                            enrichedComment.rawFileContent = fileContent
                            enrichedComment.rawFileUrl = rawComment.attachment.file_url
                        } else {
                            enrichedComment.rawFileError = `HTTP ${fileResponse.status}: ${fileResponse.statusText}`
                        }
                    }

                    return enrichedComment
                }),
            )

            return {
                content: enrichedComments.map((comment) => ({
                    type: 'text',
                    text: JSON.stringify(comment, null, 2),
                })),
            }
        },
    )
}
