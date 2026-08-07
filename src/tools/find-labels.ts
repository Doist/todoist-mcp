import type { Label } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { fetchAllSharedLabels, searchAllLabels } from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { LabelSchema as LabelOutputSchema } from '../utils/output-schemas.js'
import { formatLabelPreview, summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    searchText: z
        .string()
        .optional()
        .describe(
            'Search for a label by name (partial and case insensitive match). Supports wildcards (e.g. "work*" for prefix match). Use "\\*" for a literal asterisk. If omitted, all labels are returned.',
        ),
    limit: z
        .number()
        .int()
        .min(1)
        .max(ApiLimits.LABELS_MAX)
        .default(ApiLimits.LABELS_DEFAULT)
        .describe('The maximum number of labels to return.'),
    cursor: z
        .string()
        .optional()
        .describe(
            'The cursor to get the next page of labels (cursor is obtained from the previous call to this tool, with the same parameters). Ignored when searchText is provided.',
        ),
}

const OutputSchema = {
    labels: z.array(LabelOutputSchema).describe('The found personal labels.'),
    nextCursor: z.string().optional(),
    totalCount: z.number().describe('The total number of labels in this page.'),
    hasMore: z.boolean(),
    sharedLabels: z
        .array(z.string())
        .describe(
            'Names of all shared labels visible to you. These have no IDs or metadata — use their names directly when filtering tasks.',
        ),
    appliedFilters: z.record(z.string(), z.unknown()),
}

const findLabels = {
    name: ToolNames.FIND_LABELS,
    description:
        'List personal labels and shared labels. Personal labels have full metadata (id, name, color, order, isFavorite) and support pagination and name search (partial, case insensitive). Shared labels are labels used on tasks shared with you — they are returned as names only (no IDs or metadata). When searching, all matching personal labels are fetched across all pages and returned as a single result set (limit and cursor are ignored). When not searching, personal labels are returned with pagination.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const [personalResult, sharedLabels] = await Promise.all([
            args.searchText
                ? searchAllLabels(client, args.searchText).then((results) => ({
                      results,
                      nextCursor: null,
                  }))
                : client.getLabels({ limit: args.limit, cursor: args.cursor ?? null }),
            fetchAllSharedLabels(client),
        ])

        const { results, nextCursor } = personalResult

        const appliedFilters = args.searchText
            ? { searchText: args.searchText }
            : { limit: args.limit, cursor: args.cursor }

        return {
            textContent: generateTextContent({ labels: results, args, nextCursor, sharedLabels }),
            structuredContent: {
                labels: results.map((l) => LabelOutputSchema.parse(l)),
                nextCursor: nextCursor ?? undefined,
                totalCount: results.length,
                hasMore: Boolean(nextCursor),
                sharedLabels,
                appliedFilters,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    labels,
    args,
    nextCursor,
    sharedLabels,
}: {
    labels: Label[]
    args: z.infer<z.ZodObject<typeof ArgsSchema>>
    nextCursor: string | null
    sharedLabels: string[]
}) {
    const subject = args.searchText ? `All labels matching "${args.searchText}"` : 'Labels'

    const filterHints: string[] = []
    if (args.searchText) {
        filterHints.push(`searchText: "${args.searchText}"`)
    }

    const previewLimit = 10
    const previewLabels = labels.slice(0, previewLimit)
    const previewLines = previewLabels.map(formatLabelPreview).join('\n')
    const remainingCount = labels.length - previewLimit
    const previewWithMore =
        remainingCount > 0 ? `${previewLines}\n    …and ${remainingCount} more` : previewLines

    const zeroReasonHints: string[] = []
    if (labels.length === 0) {
        if (args.searchText) {
            zeroReasonHints.push('Try broader search terms')
            zeroReasonHints.push('Check spelling')
            zeroReasonHints.push('Remove searchText to see all labels')
        } else {
            zeroReasonHints.push('No personal labels created yet')
        }
    }

    const sharedSection =
        sharedLabels.length > 0
            ? `\nShared labels (${sharedLabels.length}): ${sharedLabels.join(', ')}`
            : '\nNo shared labels.'

    return (
        summarizeList({
            subject,
            count: labels.length,
            limit: args.searchText ? undefined : args.limit,
            nextCursor: nextCursor ?? undefined,
            filterHints,
            previewLines: previewWithMore,
            zeroReasonHints,
        }) + sharedSection
    )
}

export { findLabels }
