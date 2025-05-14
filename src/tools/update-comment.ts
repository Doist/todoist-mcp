import type { TodoistApi, UpdateCommentArgs } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function registerUpdateComment(server: McpServer, api: TodoistApi) {
    server.tool(
        'update-comment',
        'Update a comment in Todoist',
        {
            commentId: z.string().describe('The ID of the comment to update'),
            content: z.string().describe('The new content for the comment'),
        },
        async ({ commentId, content }) => {
            const updateArgs: UpdateCommentArgs = { content }

            const comment = await api.updateComment(commentId, updateArgs)
            return {
                content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }],
            }
        },
    )
}
