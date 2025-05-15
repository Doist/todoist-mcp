import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callRestTodoistApi } from '../todoist-api.js'

export function registerGetProductivityStats(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-productivity-stats',
        'Get productivity statistics for completed tasks',
        {
            limit: z
                .number()
                .optional()
                .default(30)
                .describe('Number of days to include in statistics (max 30)'),
            timezone: z
                .string()
                .optional()
                .describe('Timezone to use for statistics (IANA timezone format)'),
        },
        async ({ limit, timezone }) => {
            // Construct the query parameters
            const params = new URLSearchParams()

            if (limit) params.append('limit', limit.toString())
            if (timezone) params.append('timezone', timezone)

            const path = `/tasks/completed/stats?${params.toString()}`
            const res = await callRestTodoistApi(path, api)
            const data = await res.json()

            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        },
    )
}
