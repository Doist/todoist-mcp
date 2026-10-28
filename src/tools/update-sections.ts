import type { Section } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import {
    FailureSchema,
    SectionSchema as SectionOutputSchema,
    toSectionSummary,
} from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const SectionUpdateSchema = z
    .object({
        id: z.string().min(1).describe('The ID of the section to update.'),
        name: z.string().min(1).optional().describe('The new name of the section.'),
        description: z
            .preprocess(
                // `null` is the advertised clear value; the param schema stays a
                // plain string (Gemini forbids nullable schemas, not preprocessing),
                // so `null` is normalised to "" and then mapped to the section
                // wire clear (`null`) at execute.
                (value) => (value === null ? '' : value),
                z
                    .string()
                    .describe(
                        'The description of the section (Markdown). Pass null (or an empty string) to clear it.',
                    ),
            )
            .optional(),
    })
    .refine((data) => data.name !== undefined || data.description !== undefined, {
        message: 'Provide at least one of "name" or "description" to update.',
    })

const ArgsSchema = {
    sections: z.array(SectionUpdateSchema).min(1).describe('The sections to update.'),
}

const OutputSchema = {
    sections: z.array(SectionOutputSchema).describe('The updated sections.'),
    totalCount: z.number().describe('The total number of sections updated.'),
    updatedSectionIds: z.array(z.string()).describe('The IDs of the updated sections.'),
    failures: z
        .array(FailureSchema)
        .describe('Sections that could not be updated, with the reason for each.'),
    appliedOperations: z.object({
        updateCount: z.number(),
        failureCount: z.number(),
    }),
}

const updateSections = {
    name: ToolNames.UPDATE_SECTIONS,
    description: 'Update multiple existing sections with new values.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute({ sections }, client) {
        // Each section is updated independently, so one rejection neither discards the
        // sections that were updated nor hides them behind one error.
        const settled = await Promise.allSettled(
            sections.map(({ id, name, description }) => {
                // The SDK's UpdateSectionArgs is RequireAtLeastOne, which a
                // dynamically-built partial can't satisfy statically; the schema
                // refine guarantees at least one field. An empty `description`
                // clears it, which the section wire represents as `null`
                // (backend NULL_CLEARS).
                const updateArgs = {
                    ...(name !== undefined ? { name } : {}),
                    ...(description !== undefined
                        ? { description: description === '' ? null : description }
                        : {}),
                } as Parameters<typeof client.updateSection>[1]
                return executeWithRetry(() => client.updateSection(id, updateArgs))
            }),
        )

        const updatedSections: Section[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                updatedSections.push(result.value)
            } else {
                failures.push({
                    item: sections[index]?.id ?? `Section ${index + 1}`,
                    error: formatBatchItemError(result.reason),
                })
            }
        })

        logBatchFailures(ToolNames.UPDATE_SECTIONS, sections.length, failures)

        const textContent = generateTextContent({
            sections: updatedSections,
            failures,
        })

        return {
            textContent,
            structuredContent: {
                sections: updatedSections.map(toSectionSummary),
                totalCount: updatedSections.length,
                updatedSectionIds: updatedSections.map((section) => section.id),
                failures,
                appliedOperations: {
                    updateCount: updatedSections.length,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    sections,
    failures,
}: {
    sections: Section[]
    failures: Array<{ item: string; error: string }>
}) {
    const count = sections.length
    const sectionList = sections
        .map((section) => `• ${section.name} (id=${section.id}, projectId=${section.projectId})`)
        .join('\n')

    const summary =
        count > 0
            ? `Updated ${count} section${count === 1 ? '' : 's'}:\n${sectionList}`
            : 'Updated 0 sections'

    return appendFailureSummary(summary, failures)
}

export { updateSections }
