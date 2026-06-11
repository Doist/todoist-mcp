import type { Section } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatToolExecutionError } from '../tool-execution-error.js'
import { isInboxProjectId, resolveInboxProjectId } from '../tool-helpers.js'
import {
    FailureSchema,
    SectionSchema as SectionOutputSchema,
    toSectionSummary,
} from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
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
    failures: z
        .array(FailureSchema)
        .describe(
            'Sections that could not be created, with the reason for each. A failure here does not affect the other sections in the batch — do not retry the whole batch; address or drop the failed items.',
        ),
    totalRequested: z.number().describe('The total number of sections requested.'),
    successCount: z.number().describe('The number of successfully created sections.'),
    failureCount: z.number().describe('The number of failed section creations.'),
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

        // Each section is created independently: a failure on one (for example, the API
        // rejecting it with a 403 permission error) must not discard the sections that
        // succeeded nor collapse into one opaque batch error that invites a full retry.
        // Per-item calls go through executeWithRetry so transient 5xx failures still get
        // the same backoff the registerTool() wrapper applies to single-call tools.
        const settled = await Promise.allSettled(
            sections.map(async (section) => {
                const projectId =
                    (await resolveInboxProjectId({
                        projectId: section.projectId,
                        user: todoistUser,
                        client: todoistUser ? undefined : client,
                    })) ?? section.projectId
                return executeWithRetry(() => client.addSection({ ...section, projectId }))
            }),
        )

        const newSections: Section[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                newSections.push(result.value)
            } else {
                failures.push({
                    item: sections[index]?.name ?? `Section ${index + 1}`,
                    error: formatToolExecutionError(result.reason),
                })
            }
        })

        // If every section failed, surface a hard error instead of a misleading success.
        if (newSections.length === 0 && failures.length > 0) {
            const details = failures.map((f) => `"${f.item}": ${f.error}`).join('; ')
            throw new Error(`All ${failures.length} section(s) failed to create: ${details}`)
        }

        const textContent = generateTextContent({ sections: newSections, failures })

        return {
            textContent,
            structuredContent: {
                sections: newSections.map(toSectionSummary),
                totalCount: newSections.length,
                failures,
                totalRequested: sections.length,
                successCount: newSections.length,
                failureCount: failures.length,
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

    const summary = `Added ${count} section${count === 1 ? '' : 's'}:\n${sectionList}`

    return appendFailureSummary(summary, failures)
}

export { addSections }
