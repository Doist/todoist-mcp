import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const PREVIEW_LINE_COUNT = 5

const TEMPLATE_FORMATS = ['file', 'url'] as const

const ArgsSchema = {
    projectId: z.string().min(1).describe('The ID of the project to export as CSV.'),
    format: z
        .enum(TEMPLATE_FORMATS)
        .default('file')
        .describe(
            'How to return the CSV. "file" returns the CSV content, which can be passed straight back to import-into-project. "url" uploads it and returns a download link instead, which does not return the whole file for large projects. The link is public, permanent and cannot be revoked: anyone holding it can open it, so only use it when the user asks for a link.',
        ),
    useRelativeDates: z
        .boolean()
        .optional()
        .describe(
            'Export due dates relative to the import date (e.g. "day 3") instead of absolute dates. Defaults to false.',
        ),
}

const OutputSchema = {
    format: z.enum(TEMPLATE_FORMATS).describe('The format the template was exported in.'),
    content: z
        .string()
        .optional()
        .describe('The project as CSV. Only present when format is "file".'),
    lineCount: z
        .number()
        .optional()
        .describe('Number of rows in the exported CSV. Only present when format is "file".'),
    fileName: z
        .string()
        .optional()
        .describe('The generated file name. Only present when format is "url".'),
    fileUrl: z
        .string()
        .optional()
        .describe('The shareable download URL. Only present when format is "url".'),
}

const exportProjectAsCSV = {
    name: ToolNames.EXPORT_PROJECT_AS_CSV,
    description:
        'Export a project as CSV, like the app\'s "Export as CSV": as CSV content, or as a download link. Use it to duplicate a project, share its structure, or hand the CSV to import-into-project. To read a project rather than export it, use find-tasks instead — it returns structured tasks rather than raw CSV. The project itself is not modified, but the "url" format uploads a copy and returns a public, permanent link that anyone holding it can open.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    // Not read-only and open world: the "url" format uploads the CSV and returns a public link.
    annotations: {
        title: 'Todoist: Export Project As CSV',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    },
    // `format` is defaulted here as well as in the schema: scripts/run-tool.ts calls
    // execute() with raw JSON, so schema defaults are not applied on that path.
    async execute({ projectId, format = 'file', useRelativeDates }, client) {
        if (format === 'url') {
            const { fileName, fileUrl } = await client.exportTemplateAsUrl({
                projectId,
                useRelativeDates,
            })

            return {
                textContent: `Exported project (id=${projectId}) as a public CSV link: ${fileName}\n${fileUrl}\nAnyone holding the link can open it, and it cannot be revoked.`,
                structuredContent: { format, fileName, fileUrl },
            }
        }

        const content = await client.exportProjectAsCSV({ projectId, useRelativeDates })
        const lines = content.split('\n').filter((line) => line.trim().length > 0)

        return {
            // The full CSV already ships in structuredContent; a preview here keeps a large
            // project from being spelled out twice in the response.
            textContent: generateTextContent({ projectId, lines }),
            structuredContent: { format, content, lineCount: lines.length },
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
