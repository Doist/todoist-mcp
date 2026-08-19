import { type ColorKey, createCommand } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ColorOutputSchema, ColorSchema } from '../utils/colors.js'
import { ToolNames } from '../utils/tool-names.js'
import { FilterOutputSchema } from './find-filters.js'

const FilterSchema = z.object({
    name: z.string().min(1).describe('The name of the filter.'),
    query: z
        .string()
        .min(1)
        .describe(
            'The filter query string. Examples: "today & p1", "#Work & overdue", "@email & today", "(p1 | p2) & !assigned". ' +
                'Operators: | (OR), & (AND), ! (NOT), () grouping, , (multiple queries).',
        ),
    description: z
        .string()
        .optional()
        .describe('A markdown description explaining what the filter is for.'),
    color: ColorSchema,
    isFavorite: z
        .boolean()
        .optional()
        .describe('Whether to mark the filter as a favorite. Defaults to false.'),
})

const ArgsSchema = {
    filters: z.array(FilterSchema).min(1).describe('The array of filters to add.'),
}

const OutputSchema = {
    filters: z.array(FilterOutputSchema).describe('The created filters.'),
    totalCount: z.number().describe('The total number of filters created.'),
}

const addFilters = {
    name: ToolNames.ADD_FILTERS,
    description:
        'Add one or more new personal filters. Filters are saved custom views using query syntax to organize tasks.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ filters }, client) {
        // Todoist Sync API returns tempIdMapping with camelCase keys (snake_case → camelCase).
        // Use camelCase tempIds from the start so the lookup key matches the response key.
        const ts = Date.now()
        const tempIds = filters.map((_, i) => `tempFilterAdd${i}${ts}`)

        const commands = filters.map((filter, i) => {
            return createCommand(
                'filter_add',
                {
                    name: filter.name,
                    query: filter.query,
                    ...(filter.description !== undefined
                        ? { description: filter.description }
                        : {}),
                    ...(filter.color !== undefined ? { color: filter.color as ColorKey } : {}),
                    ...(filter.isFavorite !== undefined ? { isFavorite: filter.isFavorite } : {}),
                },
                tempIds[i],
            )
        })

        // Send commands only — combining resourceTypes + syncToken:'*' with commands
        // causes tempIdMapping to not be returned in the response.
        const response = await client.sync({ commands })
        const tempIdMapping = response.tempIdMapping ?? {}

        // Reconstruct created filters from input args + server-assigned IDs
        const createdFilters = filters
            .map((filter, i) => {
                const tempId = tempIds[i]
                const realId = tempId !== undefined ? tempIdMapping[tempId] : undefined
                if (!realId) return null
                const outputColor =
                    filter.color !== undefined ? ColorOutputSchema.parse(filter.color) : undefined
                return {
                    id: realId,
                    name: filter.name,
                    query: filter.query,
                    description: filter.description ?? null,
                    color: outputColor,
                    isFavorite: filter.isFavorite ?? false,
                    itemOrder: 0,
                }
            })
            .filter((f): f is NonNullable<typeof f> => f !== null)

        const count = createdFilters.length
        const filterList = createdFilters.map((f) => `• ${f.name} (id=${f.id})`).join('\n')
        const textContent = `Added ${count} filter${count === 1 ? '' : 's'}:\n${filterList}`

        return {
            textContent,
            structuredContent: {
                filters: createdFilters,
                totalCount: createdFilters.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { addFilters }
