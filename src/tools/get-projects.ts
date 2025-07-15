import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getMaxPaginatedResults } from '../utils/get-max-paginated-results.js'

export function registerGetProjects(server: McpServer, api: TodoistApi) {
    server.tool('get-projects', 'Get all projects from Todoist', {}, async () => {
        const projects = await getMaxPaginatedResults((params) => api.getProjects(params))
        return {
            content: projects.map((project) => ({
                type: 'text',
                text: JSON.stringify(project, null, 2),
            })),
        }
    })
}
