import { getProjectUrl, getTaskUrl } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { buildTaskSearchQuery } from '../filter-helpers.js'
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
        'Search across tasks and projects in Todoist. Returns a list of relevant results with IDs, titles, and URLs.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { query } = args

        // Search both tasks and projects in parallel
        // Use TASKS_MAX for search since this tool doesn't support pagination
        // For projects, use server-side search
        const [tasksResult, projects] = await Promise.all([
            getTasksByFilter({
                client,
                query: buildTaskSearchQuery(query),
                limit: ApiLimits.TASKS_MAX,
                cursor: undefined,
            }),
            searchAllProjects(client, query),
        ])

        // Build results array
        const results: SearchResult[] = []

        // Add task results with composite IDs
        for (const task of tasksResult.tasks) {
            results.push({
                id: `task:${task.id}`,
                title: task.content,
                url: getTaskUrl(task.id),
            })
        }

        // Add project results with composite IDs
        for (const project of projects) {
            results.push({
                id: `project:${project.id}`,
                title: project.name,
                url: getProjectUrl(project.id),
            })
        }

        return {
            textContent: JSON.stringify({ results }),
            structuredContent: { results, totalCount: results.length },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { search }
