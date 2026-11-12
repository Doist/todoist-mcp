import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const PREVIEW_LINE_COUNT = 5

const ArgsSchema = {
    projectId: z.string().min(1).describe('The ID of the project to export as CSV.'),
    useRelativeDates: z
        .boolean()
        .optional()
        .describe(
            'Export due dates relative to the import date (e.g. "day 3") instead of absolute dates. Defaults to false.',
        ),
}

const OutputSchema = {
    content: z.string().describe('The project as CSV.'),
    lineCount: z.number().describe('Rows in the CSV, including the header.'),
}

// No shareable link: the old export's link was public, permanent and unrevocable, and no
// Todoist app creates one anymore (Doist/Issues#21076).
const exportProjectAsCSV = {
    name: ToolNames.EXPORT_PROJECT_AS_CSV,
    description:
        'Export a project as CSV content, like the app\'s "Export as CSV". Pass the CSV to import-into-project, or give it to the user. To read a project rather than export it, use find-tasks instead: it returns structured tasks rather than raw CSV. The project is not modified.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        title: 'Todoist: Export Project As CSV',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
    },
    async execute({ projectId, useRelativeDates }, client) {
        const content = await client.exportProjectAsCSV({ projectId, useRelativeDates })
        const lines = content.split('\n').filter((line) => line.trim().length > 0)

        return {
            // The full CSV already ships in structuredContent; a preview here keeps a large
            // project from being spelled out twice in the response.
            textContent: generateTextContent({ projectId, lines }),
            structuredContent: { content, lineCount: lines.length },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({ projectId, lines }: { projectId: string; lines: string[] }) {
    const summary = `Exported project (id=${projectId}) as CSV (${lines.length} row${lines.length === 1 ? '' : 's'}).`
    const preview = lines.slice(0, PREVIEW_LINE_COUNT).join('\n')
    const remaining = lines.length - PREVIEW_LINE_COUNT

    if (remaining > 0) {
        return `${summary}\n\n${preview}\n… ${remaining} more row${remaining === 1 ? '' : 's'} in the full content.`
    }

    return `${summary}\n\n${preview}`
}

export { exportProjectAsCSV }
