import type {
    GetProjectCommentsArgs,
    GetTaskCommentsArgs,
    TodoistApi,
} from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

// Create a unified type for our get-comments tool that allows either taskId or projectId
type UnifiedGetCommentsArgs = {
    taskId?: string
    projectId?: string
    cursor?: string | null
    limit?: number
}

export function registerGetComments(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-comments',
        'Get comments for a task or project',
        {
            taskId: z.string().optional().describe('Task ID to get comments for'),
            projectId: z.string().optional().describe('Project ID to get comments for'),
            cursor: z.string().optional().describe('Pagination cursor'),
            limit: z.number().optional().describe('Max number of comments to return (default 50)'),
        },
        async ({ taskId, projectId, cursor, limit }) => {
            // Ensure one and only one of taskId or projectId is provided
            if ((!taskId && !projectId) || (taskId && projectId)) {
                throw new Error('You must provide exactly one of taskId or projectId')
            }

            // Create properly typed request params
            let params: GetTaskCommentsArgs | GetProjectCommentsArgs

            if (taskId) {
                params = {
                    taskId,
                    cursor: cursor || null,
                    limit,
                } as GetTaskCommentsArgs
            } else if (projectId) {
                params = {
                    projectId,
                    cursor: cursor || null,
                    limit,
                } as GetProjectCommentsArgs
            } else {
                // This should never happen due to the earlier validation
                throw new Error('You must provide exactly one of taskId or projectId')
            }

            const comments = await api.getComments(params)

            return {
                content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }],
            }
        },
    )
}
