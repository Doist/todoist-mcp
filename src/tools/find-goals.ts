import { GOAL_OWNER_TYPES } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapGoal } from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
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
        .enum(GOAL_OWNER_TYPES)
        .optional()
        .describe('Filter by ownership type. Omit for all accessible goals.'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(ApiLimits.GOALS_MAX)
        .default(ApiLimits.GOALS_DEFAULT)
        .describe('The maximum number of goals to return per page.'),
    cursor: z
        .string()
        .optional()
        .describe(
            'The cursor to get the next page of goals (cursor is obtained from the previous call to this tool, with the same parameters).',
        ),
}

const OutputSchema = {
    goals: z.array(GoalOutputSchema).describe('The found goals.'),
    nextCursor: z.string().optional().describe('Cursor for the next page of results.'),
    hasMore: z.boolean().describe('Whether there are more results available.'),
    totalCount: z.number().describe('The total number of goals returned in this page.'),
    appliedFilters: z
        .record(z.string(), z.unknown())
        .describe('The filters that were applied to the search.'),
}

const findGoals = {
    name: ToolNames.FIND_GOALS,
    description:
        'Search for goals by name or list all accessible goals. Results are paginated — use the returned `nextCursor` to fetch subsequent pages.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const response = args.searchText
            ? await client.searchGoals({
                  query: args.searchText,
                  ownerType: args.ownerType,
                  cursor: args.cursor ?? null,
                  limit: args.limit,
              })
            : await client.getGoals({
                  ownerType: args.ownerType,
                  cursor: args.cursor ?? null,
                  limit: args.limit,
              })

        const goals = response.results.map(mapGoal)
        const nextCursor = response.nextCursor ?? undefined

        const subject = args.searchText
            ? `Goals matching "${args.searchText}"`
            : 'All accessible goals'

        const previewLines =
            goals.length > 0
                ? goals
                      .map(
                          (g) =>
                              `    ${g.name} • id=${g.id} • progress=${g.progress?.percentage ?? 0}%`,
                      )
                      .join('\n')
                : undefined

        const textContent = summarizeList({
            subject,
            count: goals.length,
            limit: args.limit,
            nextCursor,
            previewLines,
            zeroReasonHints: args.searchText
                ? [
                      'Try broader search terms',
                      'Check spelling',
                      'Remove searchText to see all goals',
                  ]
                : ['No goals exist yet', `Use ${ToolNames.ADD_GOALS} to create goals`],
        })

        return {
            textContent,
            structuredContent: {
                goals,
                nextCursor,
                hasMore: Boolean(nextCursor),
                totalCount: goals.length,
                appliedFilters: args,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { findGoals }
