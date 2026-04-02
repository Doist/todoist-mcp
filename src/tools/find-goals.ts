import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { GoalSchema as GoalOutputSchema } from '../utils/output-schemas.js'
import { summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    searchText: z
        .string()
        .optional()
        .describe(
            'Search for a goal by name (partial and case insensitive match). Supports wildcards (e.g. "ship*"). If omitted, all goals are returned.',
        ),
    ownerType: z
        .enum(['USER', 'WORKSPACE'])
        .optional()
        .describe('Filter by ownership type. Omit for all accessible goals.'),
}

const OutputSchema = {
    goals: z.array(GoalOutputSchema).describe('The found goals.'),
    totalCount: z.number().describe('The total number of goals found.'),
    appliedFilters: z
        .record(z.string(), z.unknown())
        .describe('The filters that were applied to the search.'),
}

const findGoals = {
    name: ToolNames.FIND_GOALS,
    description:
        'Search for goals by name or list all accessible goals. When searching, uses server-side search.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        let results

        if (args.searchText) {
            const response = await client.searchGoals({
                query: args.searchText,
                ownerType: args.ownerType,
            })
            results = response.results
        } else {
            const response = await client.getGoals({
                ownerType: args.ownerType,
            })
            results = response.results
        }

        const goals = results.map((g) => ({
            id: g.id,
            name: g.name,
            ownerType: g.ownerType,
            ownerId: g.ownerId,
            description: g.description,
            deadline: g.deadline,
            isCompleted: g.isCompleted,
            progress: g.progress,
        }))

        const subject = args.searchText
            ? `Goals matching "${args.searchText}"`
            : 'All accessible goals'

        const previewLines =
            goals.length > 0
                ? goals
                      .map((g) => `    ${g.name} • id=${g.id} • progress=${g.progress.percentage}%`)
                      .join('\n')
                : undefined

        const textContent = summarizeList({
            subject,
            count: goals.length,
            previewLines,
            zeroReasonHints: args.searchText
                ? ['Try broader search terms', 'Check spelling', 'Remove searchText to see all goals']
                : ['No goals exist yet', `Use ${ToolNames.ADD_GOALS} to create goals`],
        })

        return {
            textContent,
            structuredContent: {
                goals,
                totalCount: goals.length,
                appliedFilters: args,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { findGoals }
