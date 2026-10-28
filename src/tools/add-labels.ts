import type { Label } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { ColorSchema } from '../utils/colors.js'
import { FailureSchema, LabelSchema as LabelOutputSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeCreateWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const LabelSchema = z.object({
    name: z.string().min(1).max(128).describe('The name of the label.'),
    color: ColorSchema,
    order: z.number().int().optional().describe('The position of the label in the label list.'),
    isFavorite: z
        .boolean()
        .optional()
        .describe('Whether the label is a favorite. Defaults to false.'),
})

const ArgsSchema = {
    labels: z.array(LabelSchema).min(1).describe('The array of labels to add.'),
}

const OutputSchema = {
    labels: z.array(LabelOutputSchema).describe('The created labels.'),
    totalCount: z.number().describe('The total number of labels created.'),
    failures: z
        .array(FailureSchema)
        .describe('Labels that could not be created, with the reason for each.'),
    totalRequested: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
}

const addLabels = {
    name: ToolNames.ADD_LABELS,
    description: 'Add one or more new personal labels.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ labels }, client) {
        // Each label is created independently, so one rejection (e.g. a duplicate name)
        // neither discards the labels that were created nor hides them behind one error.
        // A create retries only a 503: after a 502/504 the label may already exist.
        const settled = await Promise.allSettled(
            labels.map((label) => executeCreateWithRetry(() => client.addLabel(label))),
        )

        const newLabels: Label[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                newLabels.push(result.value)
            } else {
                failures.push({
                    item: labels[index]?.name ?? `Label ${index + 1}`,
                    error: formatBatchItemError(result.reason),
                })
            }
        })

        logBatchFailures(ToolNames.ADD_LABELS, labels.length, failures, { redactItems: true })

        const textContent = generateTextContent({ labels: newLabels, failures })

        return {
            textContent,
            structuredContent: {
                labels: newLabels.map((l) => LabelOutputSchema.parse(l)),
                totalCount: newLabels.length,
                failures,
                totalRequested: labels.length,
                successCount: newLabels.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    labels,
    failures,
}: {
    labels: Label[]
    failures: Array<{ item: string; error: string }>
}) {
    const count = labels.length
    const labelList = labels.map((l) => `• ${l.name} (id=${l.id})`).join('\n')
    const summary =
        count > 0
            ? `Added ${count} label${count === 1 ? '' : 's'}:\n${labelList}`
            : 'Added 0 labels'
    return appendFailureSummary(summary, failures)
}

export { addLabels }
