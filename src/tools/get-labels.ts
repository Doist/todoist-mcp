import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getMaxPaginatedResults } from '../utils/get-max-paginated-results.js'

export function registerGetLabels(server: McpServer, api: TodoistApi) {
    server.tool('get-labels', 'Get all labels in Todoist', {}, async () => {
        const labels = await getMaxPaginatedResults((params) => api.getLabels(params))
        return {
            content: labels.map((label) => ({
                type: 'text',
                text: JSON.stringify(label, null, 2),
            })),
        }
    })
}
