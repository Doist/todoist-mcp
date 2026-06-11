import type { Section } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { SectionSchema as SectionOutputSchema, toSectionSummary } from '../utils/output-schemas.js'
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
                    .describe('The description of the section (Markdown). Pass null to clear it.'),
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
}

const updateSections = {
    name: ToolNames.UPDATE_SECTIONS,
    description: 'Update multiple existing sections with new values.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute({ sections }, client) {
        const updatedSections = await Promise.all(
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
                return client.updateSection(id, updateArgs)
            }),
        )

        const textContent = generateTextContent({
            sections: updatedSections,
        })

        return {
            textContent,
            structuredContent: {
                sections: updatedSections.map(toSectionSummary),
                totalCount: updatedSections.length,
                updatedSectionIds: updatedSections.map((section) => section.id),
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({ sections }: { sections: Section[] }) {
    const count = sections.length
    const sectionList = sections
        .map((section) => `• ${section.name} (id=${section.id}, projectId=${section.projectId})`)
        .join('\n')

    const summary = `Updated ${count} section${count === 1 ? '' : 's'}:\n${sectionList}`

    return summary
}

export { updateSections }
