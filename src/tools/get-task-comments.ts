import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMaxPaginatedResults } from '../utils/get-max-paginated-results.js'

export function registerGetTaskComments(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-task-comments',
        'Get comments from a task in Todoist',
        { taskId: z.string() },
        async ({ taskId }) => {
            const comments = await getMaxPaginatedResults((params) =>
                api.getComments({ taskId, ...params }),
            )
            return {
                content: comments.map((comment) => ({
                    type: 'text',
                    text: JSON.stringify(comment, null, 2),
                })),
            }
        },
    )
}
