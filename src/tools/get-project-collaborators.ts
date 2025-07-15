import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMaxPaginatedResults } from '../utils/get-max-paginated-results.js'

export function registerGetProjectCollaborators(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-project-collaborators',
        'Get all collaborators from a project in Todoist',
        {
            projectId: z.string(),
        },
        async ({ projectId }) => {
            const collaborators = await getMaxPaginatedResults((params) =>
                api.getProjectCollaborators(projectId, params),
            )
            return {
                content: collaborators.map((collaborator) => ({
                    type: 'text',
                    text: JSON.stringify(collaborator, null, 2),
                })),
            }
        },
    )
}
