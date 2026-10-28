import { type ColorKey, createCommand, type Filter } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { ColorOutputSchema, ColorSchema } from '../utils/colors.js'
import { readFilterDescription } from '../utils/filter-description.js'
import { FailureSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { settleSyncCommands } from '../utils/sync-commands.js'
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
        .preprocess(
            // Keep accepting legacy null while exposing a Gemini-compatible string schema.
            (value) => (value === null ? 'remove' : value),
            z
                .string()
                .describe(
                    'A markdown description explaining what the filter is for. Use "remove" to clear the description; omit the field to leave it unchanged.',
                ),
        )
        .optional(),
    color: ColorSchema,
    isFavorite: z.boolean().optional().describe('Whether to mark the filter as a favorite.'),
})

type FilterUpdate = z.infer<typeof FilterUpdateSchema>
type SkipReason = 'no-fields'

const ArgsSchema = {
    filters: z.array(FilterUpdateSchema).min(1).describe('The filters to update.'),
}

const OutputSchema = {
    filters: z
        .array(FilterOutputSchema)
        .describe(
            'The updated filters, as read back after the update. Empty if they could not be read back; updatedFilterIds still lists what was updated.',
        ),
    totalCount: z.number().describe('The total number of filters updated.'),
    updatedFilterIds: z.array(z.string()).describe('The IDs of the updated filters.'),
    failures: z
        .array(FailureSchema)
        .describe('Filters that could not be updated, with the reason for each.'),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('The number of filters actually updated.'),
            skippedCount: z.number().describe('The number of filters skipped (no changes).'),
            failureCount: z.number(),
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
                    failures: [],
                    appliedOperations: { updateCount: 0, skippedCount, failureCount: 0 },
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
        const { outcomes } = await settleSyncCommands(client, commands)

        const updatedIds: string[] = []
        const failures: Array<{ item: string; error: string }> = []
        outcomes.forEach((outcome, i) => {
            const id = toUpdate[i]?.id ?? `Filter ${i + 1}`
            if (outcome.status === 'fulfilled') {
                updatedIds.push(id)
            } else {
                failures.push({ item: id, error: formatBatchItemError(outcome.reason) })
            }
        })

        logBatchFailures(ToolNames.UPDATE_FILTERS, filters.length, failures)

        // The updates are already applied, so a failed read-back is reported rather than
        // thrown: throwing would hide changes the caller would then make a second time.
        let updatedFilters: z.infer<typeof FilterOutputSchema>[] = []
        let readBackError: string | undefined
        if (updatedIds.length > 0) {
            // Only the request is caught: a filter that fails to map is a schema
            // mismatch, which should still fail loudly.
            let readBack: Filter[] | undefined
            try {
                const readResponse = await executeWithRetry(() =>
                    client.sync({ resourceTypes: ['filters'], syncToken: '*' }),
                )
                readBack = readResponse.filters ?? []
            } catch (error) {
                readBackError = formatBatchItemError(error)
                console.error(`${ToolNames.UPDATE_FILTERS}: read-back failed`, {
                    updated: updatedIds.length,
                    error: readBackError,
                })
            }
            if (readBack) {
                updatedFilters = toUpdatedFilters(readBack, new Set(updatedIds))
            }
        }

        const textContent = appendFailureSummary(
            generateTextContent({
                filters: updatedFilters,
                updatedIds,
                skippedCount,
                readBackError,
            }),
            failures,
        )

        return {
            textContent,
            structuredContent: {
                filters: updatedFilters,
                totalCount: updatedIds.length,
                updatedFilterIds: updatedIds,
                failures,
                appliedOperations: {
                    updateCount: updatedIds.length,
                    skippedCount,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function toUpdatedFilters(
    filters: Filter[],
    ids: Set<string>,
): z.infer<typeof FilterOutputSchema>[] {
    return filters
        .filter((f) => !f.isDeleted && ids.has(f.id))
        .map((f) => ({
            id: f.id,
            name: f.name,
            query: f.query,
            description: readFilterDescription(f),
            color: ColorOutputSchema.parse(f.color),
            isFavorite: f.isFavorite,
            itemOrder: f.itemOrder,
        }))
}

function generateTextContent({
    filters,
    updatedIds,
    skippedCount,
    readBackError,
}: {
    filters: Array<{ id: string; name: string }>
    updatedIds: string[]
    skippedCount: number
    readBackError: string | undefined
}) {
    const count = updatedIds.length
    let summary = `Updated ${count} filter${count === 1 ? '' : 's'}`

    if (skippedCount > 0) {
        summary += ` (${skippedCount} skipped - no changes)`
    }

    if (readBackError) {
        summary += `: ${updatedIds.join(', ')}\nThe updated filters could not be read back: ${readBackError}`
    } else if (filters.length > 0) {
        const filterList = filters.map((f) => `• ${f.name} (id=${f.id})`).join('\n')
        summary += `:\n${filterList}`
    }

    return summary
}

function getSkipReason({ id: _id, ...otherUpdateArgs }: FilterUpdate): SkipReason | null {
    const values = Object.values(otherUpdateArgs)
    if (values.every((v) => v === undefined)) return 'no-fields'
    return null
}

export { updateFilters }
