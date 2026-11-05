import { z } from 'zod'

const LABELS_OPERATORS = ['and', 'or'] as const
type LabelsOperator = (typeof LABELS_OPERATORS)[number]

export const LabelsSchema = {
    labels: z.string().array().optional().describe('The labels to filter the tasks by'),
    labelsOperator: z
        .enum(LABELS_OPERATORS)
        .optional()
        .describe(
            'The operator to use when filtering by labels. This will dictate whether a task has all labels, or some of them. Default is "or".',
        ),
}

/**
 * Formats labels for human-readable filter hints, e.g. "@work & @urgent".
 */
export function formatLabelsHint(labels: string[], labelsOperator: LabelsOperator = 'or') {
    return labels.map((label) => `@${label}`).join(labelsOperator === 'and' ? ' & ' : ' | ')
}

export function generateLabelsFilter(labels: string[] = [], labelsOperator: LabelsOperator = 'or') {
    if (labels.length === 0) return ''
    const operator = labelsOperator === 'and' ? ' & ' : ' | '
    // Add @ prefix to labels for Todoist API query
    const prefixedLabels = labels.map((label) => (label.startsWith('@') ? label : `@${label}`))
    const labelStr = prefixedLabels.join(` ${operator} `)
    return `(${labelStr})`
}
