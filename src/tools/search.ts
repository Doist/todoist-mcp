import { getProjectUrl, getTaskUrl } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { getTasksByFilter, searchAllProjects } from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    query: z.string().min(1).describe('The search query string to find tasks and projects.'),
}

type SearchResult = {
    id: string
    title: string
    url: string
}

const OutputSchema = {
    results: z
        .array(
            z.object({
                id: z.string().describe('The ID of the result.'),
                title: z.string().describe('The title of the result.'),
                url: z.string().describe('The URL of the result.'),
            }),
        )
        .describe('The search results.'),
    totalCount: z.number().describe('Total number of results found.'),
}

/**
 * OpenAI MCP search tool - returns a list of relevant search results from Todoist.
 *
 * This tool follows the OpenAI MCP search tool specification:
 * @see https://platform.openai.com/docs/mcp#search-tool
 */
const search = {
    name: ToolNames.SEARCH,
    description:
        'Search across active tasks, completed tasks, and projects in Todoist. Returns a list of relevant results with IDs, titles, and URLs. Completed task titles start with "[completed]".',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { query } = args

        // Search active tasks, completed tasks, and projects in parallel
        // Use TASKS_MAX for search since this tool doesn't support pagination
        // Completed task search returns at most one 50-item page
        // For projects, use server-side search
        const [tasksResult, completedTasksResult, projects] = await Promise.all([
            getTasksByFilter({
                client,
                query: `search: ${query}`,
                limit: ApiLimits.TASKS_MAX,
                cursor: undefined,
            }),
            client.searchCompletedTasks({ query, limit: ApiLimits.COMPLETED_TASKS_DEFAULT }),
            searchAllProjects(client, query),
        ])

        // Build results with composite IDs: active tasks, then completed tasks, then projects
        const results: SearchResult[] = [
            ...tasksResult.tasks.map((task) => ({
                id: `task:${task.id}`,
                title: task.content,
                url: getTaskUrl(task.id),
            })),
            ...completedTasksResult.items.map((task) => ({
                id: `task:${task.id}`,
                title: `[completed] ${task.content}`,
                url: getTaskUrl(task.id),
            })),
            ...projects.map((project) => ({
                id: `project:${project.id}`,
                title: project.name,
                url: getProjectUrl(project.id),
            })),
        ]

        return {
            textContent: JSON.stringify({ results }),
            structuredContent: { results, totalCount: results.length },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { search }
