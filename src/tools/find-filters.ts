import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ColorOutputSchema } from '../utils/colors.js'
import { readFilterDescription } from '../utils/filter-description.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    search: z
        .string()
        .optional()
        .describe(
            'Search for a filter by name (partial and case insensitive match). If omitted, all filters are returned.',
        ),
}

const FilterOutputSchema = z.object({
    id: z.string().describe('The unique ID of the filter.'),
    name: z.string().describe('The name of the filter.'),
    query: z.string().describe('The filter query string (e.g. "today & p1", "#Work & overdue").'),
    description: z
        .string()
        .nullish()
        .describe(
            'A markdown description explaining what the filter is for. Null when the filter has none.',
        ),
    color: ColorOutputSchema,
    isFavorite: z.boolean().describe('Whether the filter is marked as favorite.'),
    itemOrder: z.number().describe('The display order of the filter.'),
})

const OutputSchema = {
    filters: z.array(FilterOutputSchema).describe('The found filters.'),
    totalCount: z.number().describe('The total number of filters returned.'),
}

const findFilters = {
    name: ToolNames.FIND_FILTERS,
    description:
        'List all personal filters or search for filters by name. Filters are saved custom views that use query syntax to organize tasks (e.g. "today & p1", "#Work & overdue").',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const response = await client.sync({ resourceTypes: ['filters'], syncToken: '*' })
        let filters = (response.filters ?? []).filter((f) => !f.isDeleted)

        if (args.search) {
            const searchLower = args.search.toLowerCase()
            filters = filters.filter((f) => f.name.toLowerCase().includes(searchLower))
        }

        filters.sort((a, b) => a.itemOrder - b.itemOrder)

        const mappedFilters = filters.map((f) => ({
            id: f.id,
            name: f.name,
            query: f.query,
            description: readFilterDescription(f),
            color: ColorOutputSchema.parse(f.color),
            isFavorite: f.isFavorite,
            itemOrder: f.itemOrder,
        }))

        const textContent = generateTextContent({ filters: mappedFilters, search: args.search })

        return {
            textContent,
            structuredContent: {
                filters: mappedFilters,
                totalCount: mappedFilters.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    filters,
    search,
}: {
    filters: Array<{ id: string; name: string; query: string; isFavorite: boolean }>
    search?: string
}) {
    const subject = search ? `Filters matching "${search}"` : 'Filters'

    if (filters.length === 0) {
        const hints = search
            ? ['Try broader search terms', 'Check spelling', 'Remove search to see all filters']
            : ['No filters created yet', `Use ${ToolNames.ADD_FILTERS} to create a filter`]
        return `${subject}: 0 found\n\nSuggestions:\n${hints.map((h) => `- ${h}`).join('\n')}`
    }

    const lines = [`${subject}: ${filters.length} found`, '']
    for (const f of filters) {
        const favorite = f.isFavorite ? ' ★' : ''
        lines.push(`• ${f.name}${favorite} (id=${f.id})`)
        lines.push(`  Query: ${f.query}`)
    }
    return lines.join('\n')
}

export { FilterOutputSchema, findFilters }
