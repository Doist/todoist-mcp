import type { Section } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { resolveInboxProjectId, searchAllSections } from '../tool-helpers.js'
import { SectionSchema as SectionOutputSchema, toSectionSummary } from '../utils/output-schemas.js'
import { summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const { ADD_SECTIONS } = ToolNames

const ArgsSchema = {
    projectId: z
        .string()
        .min(1)
        .describe(
            'The ID of the project to search sections in. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
    searchText: z
        .string()
        .optional()
        .describe(
            'Search for a section by name (partial and case insensitive match). Supports wildcards (e.g. "work*" for prefix match). Use "\\*" for a literal asterisk. If omitted, all sections in the project are returned.',
        ),
}

type SectionSummary = {
    id: string
    name: string
}

const OutputSchema = {
    sections: z.array(SectionOutputSchema).describe('The found sections.'),
    totalCount: z.number().describe('The total number of sections found.'),
    appliedFilters: z
        .record(z.string(), z.unknown())
        .describe('The filters that were applied to the search.'),
}

const findSections = {
    name: ToolNames.FIND_SECTIONS,
    description:
        'Search for sections by name or other criteria in a project. When searching, uses server-side search to avoid fetching all sections.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        // Resolve "inbox" to actual inbox project ID if needed
        const resolvedProjectId = await resolveInboxProjectId({
            projectId: args.projectId,
            client,
        })

        let results: Section[]

        if (args.searchText) {
            // When searching, fetch ALL matching sections (server-side search)
            results = await searchAllSections(client, args.searchText, resolvedProjectId)
        } else {
            // Normal single-page fetch when not searching
            const response = await client.getSections({
                projectId: resolvedProjectId,
            })
            results = response.results
        }

        const sections = results.map(toSectionSummary)

        const textContent = generateTextContent({
            sections,
            projectId: args.projectId,
            searchText: args.searchText,
        })

        return {
            textContent,
            structuredContent: {
                sections,
                totalCount: sections.length,
                appliedFilters: args,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    sections,
    projectId,
    searchText,
}: {
    sections: SectionSummary[]
    projectId: string
    searchText?: string
}): string {
    const zeroReasonHints: string[] = []

    if (searchText) {
        zeroReasonHints.push('Try broader search terms')
        zeroReasonHints.push('Check spelling')
        zeroReasonHints.push('Remove searchText to see all sections')
    } else {
        zeroReasonHints.push('Project has no sections yet')
        zeroReasonHints.push(`Use ${ADD_SECTIONS} to create sections`)
    }

    // Data-driven next steps based on results
    const subject = searchText
        ? `Sections in project ${projectId} matching "${searchText}"`
        : `Sections in project ${projectId}`

    const previewLines =
        sections.length > 0
            ? sections.map((section) => `    ${section.name} • id=${section.id}`).join('\n')
            : undefined

    return summarizeList({
        subject,
        count: sections.length,
        previewLines,
        zeroReasonHints,
    })
}

export { findSections }
