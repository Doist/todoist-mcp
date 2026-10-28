import type { Label } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { ColorSchema } from '../utils/colors.js'
import { FailureSchema, LabelSchema as LabelOutputSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const PersonalLabelUpdateSchema = z.object({
    labelType: z.literal('personal').describe('Update a personal label, identified by its ID.'),
    id: z.string().min(1).describe('The ID of the personal label to update.'),
    name: z.string().min(1).max(128).optional().describe('The new name of the label.'),
    color: ColorSchema,
    order: z.number().int().optional().describe('The new position of the label in the label list.'),
    isFavorite: z.boolean().optional().describe('Whether to mark the label as a favorite.'),
})

const SharedLabelUpdateSchema = z.object({
    labelType: z
        .literal('shared')
        .describe(
            'Rename a shared label across all tasks. Shared labels are identified by name; only renaming is supported (no color, order, or favorite).',
        ),
    name: z.string().min(1).describe('The current name of the shared label.'),
    newName: z.string().min(1).describe('The new name for the shared label.'),
})

const LabelUpdateSchema = z.discriminatedUnion('labelType', [
    PersonalLabelUpdateSchema,
    SharedLabelUpdateSchema,
])

type PersonalLabelUpdate = z.infer<typeof PersonalLabelUpdateSchema>
type SkipReason = 'no-fields' | 'not-found'

const ArgsSchema = {
    labels: z
        .array(LabelUpdateSchema)
        .min(1)
        .describe(
            'The labels to update. Use labelType="personal" with an ID to update a personal label, or labelType="shared" with name+newName to rename a shared label.',
        ),
}

const SharedRenameResultSchema = z.object({
    name: z.string().describe('The previous name of the shared label.'),
    newName: z.string().describe('The new name of the shared label.'),
})

const OutputSchema = {
    updatedLabels: z.array(LabelOutputSchema).describe('The updated personal labels.'),
    renamedSharedLabels: z
        .array(SharedRenameResultSchema)
        .describe('The shared labels that were renamed.'),
    totalCount: z
        .number()
        .describe('The total number of successful operations (personal + shared).'),
    failures: z
        .array(FailureSchema)
        .describe(
            'Labels that could not be updated, identified by ID (personal) or name (shared), with the reason for each.',
        ),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('Number of personal labels updated.'),
            renameCount: z.number().describe('Number of shared labels renamed.'),
            skippedCount: z
                .number()
                .describe('Number of operations skipped (no changes or shared label not found).'),
            failureCount: z.number().describe('Number of labels that failed to update.'),
        })
        .describe('Summary of operations performed.'),
}

const updateLabels = {
    name: ToolNames.UPDATE_LABELS,
    description:
        'Update one or more existing labels. Personal labels (identified by ID) can have their name, color, order, and favorite flag updated. Shared labels (identified by name) can only be renamed.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        const { labels } = args

        type Result =
            | { kind: 'updated'; label: Label }
            | { kind: 'renamed'; name: string; newName: string }
            | { kind: 'skipped'; reason: SkipReason }

        // Each label is updated independently, so one rejection neither discards the
        // labels that were updated nor hides them behind one error.
        const settled = await Promise.allSettled(
            labels.map(async (label): Promise<Result> => {
                if (label.labelType === 'personal') {
                    const skipReason = getPersonalSkipReason(label)
                    if (skipReason !== null) return { kind: 'skipped', reason: skipReason }

                    const { id, labelType: _labelType, ...updateArgs } = label
                    const updated = await executeWithRetry(() => client.updateLabel(id, updateArgs))
                    return { kind: 'updated', label: updated }
                }

                const ok = await executeWithRetry(() =>
                    client.renameSharedLabel({ name: label.name, newName: label.newName }),
                )
                if (!ok) return { kind: 'skipped', reason: 'not-found' }
                return { kind: 'renamed', name: label.name, newName: label.newName }
            }),
        )

        const results: Result[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                results.push(result.value)
                return
            }
            const label = labels[index]
            failures.push({
                item: label
                    ? label.labelType === 'personal'
                        ? label.id
                        : label.name
                    : `Label ${index + 1}`,
                error: formatBatchItemError(result.reason),
            })
        })

        // A shared label is identified by its name, which is the caller's own text.
        logBatchFailures(ToolNames.UPDATE_LABELS, labels.length, failures, { redactItems: true })

        const updatedLabels = results
            .filter((r): r is { kind: 'updated'; label: Label } => r.kind === 'updated')
            .map((r) => LabelOutputSchema.parse(r.label))

        const renamedSharedLabels = results
            .filter(
                (r): r is { kind: 'renamed'; name: string; newName: string } =>
                    r.kind === 'renamed',
            )
            .map(({ name, newName }) => ({ name, newName }))

        const skippedCount = results.filter((r) => r.kind === 'skipped').length
        const skippedNoFields = results.filter(
            (r) => r.kind === 'skipped' && r.reason === 'no-fields',
        ).length
        const skippedNotFound = results.filter(
            (r) => r.kind === 'skipped' && r.reason === 'not-found',
        ).length

        const textContent = appendFailureSummary(
            generateTextContent({
                updatedLabels,
                renamedSharedLabels,
                skippedNoFields,
                skippedNotFound,
            }),
            failures,
        )

        return {
            textContent,
            structuredContent: {
                updatedLabels,
                renamedSharedLabels,
                totalCount: updatedLabels.length + renamedSharedLabels.length,
                failures,
                appliedOperations: {
                    updateCount: updatedLabels.length,
                    renameCount: renamedSharedLabels.length,
                    skippedCount,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    updatedLabels,
    renamedSharedLabels,
    skippedNoFields,
    skippedNotFound,
}: {
    updatedLabels: Array<{ id: string; name: string }>
    renamedSharedLabels: Array<{ name: string; newName: string }>
    skippedNoFields: number
    skippedNotFound: number
}) {
    const updateCount = updatedLabels.length
    const renameCount = renamedSharedLabels.length
    const total = updateCount + renameCount

    const lines: string[] = []
    lines.push(
        `Updated ${total} label${total === 1 ? '' : 's'} (${updateCount} personal, ${renameCount} shared)`,
    )

    const skipParts: string[] = []
    if (skippedNoFields > 0) skipParts.push(`${skippedNoFields} skipped - no changes`)
    if (skippedNotFound > 0) skipParts.push(`${skippedNotFound} skipped - shared label not found`)
    if (skipParts.length > 0) lines[0] += ` (${skipParts.join(', ')})`

    if (updateCount > 0) {
        lines.push('Personal:')
        for (const l of updatedLabels) lines.push(`• ${l.name} (id=${l.id})`)
    }
    if (renameCount > 0) {
        lines.push('Shared:')
        for (const r of renamedSharedLabels) lines.push(`• ${r.name} → ${r.newName}`)
    }

    return lines.join('\n')
}

function getPersonalSkipReason({
    id: _id,
    labelType: _labelType,
    ...otherUpdateArgs
}: PersonalLabelUpdate): SkipReason | null {
    const values = Object.values(otherUpdateArgs)
    if (values.every((v) => v === undefined)) return 'no-fields'
    return null
}

export { updateLabels }
