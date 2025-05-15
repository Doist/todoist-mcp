import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callRestTodoistApi } from '../todoist-api.js'

// Since the Todoist TypeScript API client doesn't expose the completed tasks endpoint directly,
// we'll need to make a custom request to the API
export function registerGetTasksCompletedByCompletionDate(server: McpServer, api: TodoistApi) {
    server.tool(
        'get-tasks-completed-by-completion-date',
        'Get tasks completed within a specific date range',
        {
            since: z.string().describe('Start date for completed tasks (YYYY-MM-DD format)'),
            until: z.string().describe('End date for completed tasks (YYYY-MM-DD format)'),
            workspace_id: z.number().optional().describe('Filter by workspace ID'),
            project_id: z.string().optional().describe('Filter by project ID'),
            section_id: z.string().optional().describe('Filter by section ID'),
            parent_id: z.string().optional().describe('Filter by parent task ID'),
            filter_query: z.string().optional().describe('Filter using Todoist query syntax'),
            filter_lang: z.string().optional().describe('Language for filter query'),
            limit: z.number().optional().default(50).describe('Number of tasks to return (max 50)'),
            cursor: z.string().optional().describe('Cursor for pagination'),
        },
        async ({
            since,
            until,
            workspace_id,
            project_id,
            section_id,
            parent_id,
            filter_query,
            filter_lang,
            limit,
            cursor,
        }) => {
            // Construct the query parameters
            const params = new URLSearchParams({
                since,
                until,
            })

            if (workspace_id) params.append('workspace_id', workspace_id.toString())
            if (project_id) params.append('project_id', project_id)
            if (section_id) params.append('section_id', section_id)
            if (parent_id) params.append('parent_id', parent_id)
            if (filter_query) params.append('filter_query', filter_query)
            if (filter_lang) params.append('filter_lang', filter_lang)
            if (limit) params.append('limit', limit.toString())
            if (cursor) params.append('cursor', cursor)

            const path = `/tasks/completed/by_completion_date?${params.toString()}`
            const res = await callRestTodoistApi(path, api)
            const data = await res.json()

            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        },
    )
}
