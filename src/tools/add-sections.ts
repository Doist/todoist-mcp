import type { Section } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { isInboxProjectId, resolveInboxProjectId } from '../tool-helpers.js'
import { SectionSchema as SectionOutputSchema, toSectionSummary } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const SectionSchema = z.object({
    name: z.string().min(1).describe('The name of the section.'),
    projectId: z
        .string()
        .min(1)
        .describe(
            'The ID of the project to add the section to. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
})

const ArgsSchema = {
    sections: z.array(SectionSchema).min(1).describe('The array of sections to add.'),
}

const OutputSchema = {
    sections: z.array(SectionOutputSchema).describe('The created sections.'),
    totalCount: z.number().describe('The total number of sections created.'),
}

const addSections = {
    name: ToolNames.ADD_SECTIONS,
    description: 'Add one or more new sections to projects.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ sections }, client) {
        // Check if any section needs inbox resolution
        const needsInboxResolution = sections.some((section) => isInboxProjectId(section.projectId))
        const todoistUser = needsInboxResolution ? await client.getUser() : undefined

        // Resolve inbox project IDs
        const sectionsWithResolvedProjectIds = await Promise.all(
            sections.map(async (section) => ({
                ...section,
                projectId:
                    (await resolveInboxProjectId({
                        projectId: section.projectId,
                        user: todoistUser,
                        client: todoistUser ? undefined : client,
                    })) ?? section.projectId,
            })),
        )

        const newSections = await Promise.all(
            sectionsWithResolvedProjectIds.map((section) => client.addSection(section)),
        )
        const textContent = generateTextContent({ sections: newSections })

        return {
            textContent,
            structuredContent: {
                sections: newSections.map(toSectionSummary),
                totalCount: newSections.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({ sections }: { sections: Section[] }) {
    const count = sections.length
    const sectionList = sections
        .map((section) => `• ${section.name} (id=${section.id}, projectId=${section.projectId})`)
        .join('\n')

    const summary = `Added ${count} section${count === 1 ? '' : 's'}:\n${sectionList}`

    return summary
}

export { addSections }
