import { type ColorKey, createCommand } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ColorOutputSchema, ColorSchema } from '../utils/colors.js'
import { readFilterDescription } from '../utils/filter-description.js'
import { ToolNames } from '../utils/tool-names.js'
import { FilterOutputSchema } from './find-filters.js'

const FilterUpdateSchema = z.object({
    id: z.string().min(1).describe('The ID of the filter to update.'),
    name: z.string().min(1).optional().describe('The new name of the filter.'),
    query: z
        .string()
        .min(1)
        .optional()
        .describe(
            'The new filter query string. Examples: "today & p1", "#Work & overdue", "@email & today".',
        ),
    description: z
        .string()
        .optional()
        .describe(
            'A markdown description explaining what the filter is for. Use "remove" to clear the description; omit the field to leave it unchanged.',
        ),
    color: ColorSchema,
    isFavorite: z.boolean().optional().describe('Whether to mark the filter as a favorite.'),
})

type FilterUpdate = z.infer<typeof FilterUpdateSchema>
type SkipReason = 'no-fields'

const ArgsSchema = {
    filters: z.array(FilterUpdateSchema).min(1).describe('The filters to update.'),
}

const OutputSchema = {
    filters: z.array(FilterOutputSchema).describe('The updated filters.'),
    totalCount: z.number().describe('The total number of filters updated.'),
    updatedFilterIds: z.array(z.string()).describe('The IDs of the updated filters.'),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('The number of filters actually updated.'),
            skippedCount: z.number().describe('The number of filters skipped (no changes).'),
        })
        .describe('Summary of operations performed.'),
}

const updateFilters = {
    name: ToolNames.UPDATE_FILTERS,
    description: 'Update one or more existing personal filters with new values.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        const { filters } = args

        type Result =
            | { kind: 'updated'; filter: FilterUpdate }
            | { kind: 'skipped'; reason: SkipReason }

        const toUpdate: FilterUpdate[] = []
        const results: Result[] = filters.map((filter) => {
            const skipReason = getSkipReason(filter)
            if (skipReason !== null) return { kind: 'skipped', reason: skipReason }
            toUpdate.push(filter)
            return { kind: 'updated', filter }
        })

        const skippedCount = results.filter((r) => r.kind === 'skipped').length

        if (toUpdate.length === 0) {
            return {
                textContent: `Updated 0 filters (${skippedCount} skipped - no changes)`,
                structuredContent: {
                    filters: [],
                    totalCount: 0,
                    updatedFilterIds: [],
                    appliedOperations: { updateCount: 0, skippedCount },
                },
            }
        }

        const commands = toUpdate.map((filter) => {
            const { id, color, description, ...otherArgs } = filter
            return createCommand('filter_update', {
                id,
                ...otherArgs,
                // "remove" is the house sentinel for clearing a field; the API clears on null.
                ...(description !== undefined
                    ? { description: description === 'remove' ? null : description }
                    : {}),
                ...(color !== undefined ? { color: color as ColorKey } : {}),
            })
        })

        // Send commands only — then read back separately to get accurate server state
        await client.sync({ commands })

        const readResponse = await client.sync({ resourceTypes: ['filters'], syncToken: '*' })
        const allFilters = (readResponse.filters ?? []).filter((f) => !f.isDeleted)
        const updatedIds = new Set(toUpdate.map((f) => f.id))
        const updatedFilters = allFilters
            .filter((f) => updatedIds.has(f.id))
            .map((f) => ({
                id: f.id,
                name: f.name,
                query: f.query,
                description: readFilterDescription(f),
                color: ColorOutputSchema.parse(f.color),
                isFavorite: f.isFavorite,
                itemOrder: f.itemOrder,
            }))

        const textContent = generateTextContent({ filters: updatedFilters, skippedCount })

        return {
            textContent,
            structuredContent: {
                filters: updatedFilters,
                totalCount: updatedFilters.length,
                updatedFilterIds: updatedFilters.map((f) => f.id),
                appliedOperations: {
                    updateCount: updatedFilters.length,
                    skippedCount,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    filters,
    skippedCount,
}: {
    filters: Array<{ id: string; name: string }>
    skippedCount: number
}) {
    const count = filters.length
    let summary = `Updated ${count} filter${count === 1 ? '' : 's'}`

    if (skippedCount > 0) {
        summary += ` (${skippedCount} skipped - no changes)`
    }

    if (count > 0) {
        const filterList = filters.map((f) => `• ${f.name} (id=${f.id})`).join('\n')
        summary += `:\n${filterList}`
    }

    return summary
}

function getSkipReason({ id, ...otherUpdateArgs }: FilterUpdate): SkipReason | null {
    const values = Object.values(otherUpdateArgs)
    if (values.length === 0 || values.every((v) => v === undefined)) return 'no-fields'
    return null
}

export { updateFilters }
