import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMaxPaginatedResults } from '../utils/get-max-paginated-results.js'

export function registerGetSharedLabels(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-shared-labels',
        'Retrieves a list of shared labels in Todoist',
        {
            omitPersonal: z.boolean().optional(),
        },
        async ({ omitPersonal }) => {
            const labels = await getMaxPaginatedResults((params) =>
                api.getSharedLabels({ omitPersonal, ...params }),
            )
            return {
                content: labels.map((label) => ({
                    type: 'text',
                    text: JSON.stringify(label, null, 2),
                })),
            }
        },
    )
}
