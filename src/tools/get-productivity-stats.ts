import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

// Interface for internal API properties
interface TodoistApiInternal {
    restApiBase: string
    authToken: string
}

// Since the Todoist TypeScript API client doesn't expose productivity stats directly,
// we'll need to make a custom request to the API
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

            // Access the private properties with a type assertion
            const baseUrl =
                (api as unknown as TodoistApiInternal).restApiBase || 'https://api.todoist.com'
            const authToken = (api as unknown as TodoistApiInternal).authToken

            // Make API request
            const response = await fetch(
                `${baseUrl}/api/v1/tasks/completed/stats?${params.toString()}`,
                {
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                    },
                },
            )

            if (!response.ok) {
                throw new Error(`Todoist API error: ${response.status} ${await response.text()}`)
            }

            const data = await response.json()

            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            }
        },
    )
}
