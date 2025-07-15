import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMaxPaginatedResults } from '../utils/get-max-paginated-results.js'

export function registerGetSections(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-sections',
        'Get all sections from a project in Todoist',
        {
            projectId: z.string(),
        },
        async ({ projectId }) => {
            const sections = await getMaxPaginatedResults((params) =>
                api.getSections({ projectId, ...params }),
            )
            return {
                content: sections.map((section) => ({
                    type: 'text',
                    text: JSON.stringify(section, null, 2),
                })),
            }
        },
    )
}
