import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const PREVIEW_LINE_COUNT = 5

const TEMPLATE_FORMATS = ['file', 'url'] as const

const ArgsSchema = {
    projectId: z.string().min(1).describe('The ID of the project to export as a template.'),
    format: z
        .enum(TEMPLATE_FORMATS)
        .default('file')
        .describe(
            'How to return the template. "file" returns the CSV content, which can be passed straight back to import-project-template. "url" returns a shareable download link instead, and is the better choice for large projects because it does not return the whole file.',
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
        .describe('The template as CSV content. Only present when format is "file".'),
    lineCount: z
        .number()
        .optional()
        .describe('Number of rows in the exported CSV. Only present when format is "file".'),
    fileName: z
        .string()
        .optional()
        .describe('The generated template file name. Only present when format is "url".'),
    fileUrl: z
        .string()
        .optional()
        .describe('The shareable download URL. Only present when format is "url".'),
}

const exportProjectTemplate = {
    name: ToolNames.EXPORT_PROJECT_TEMPLATE,
    description:
        'Export an existing project as a Todoist template, either as CSV content or as a shareable URL. Use it to duplicate a project, share its structure, or hand the CSV to import-project-template. To read a project rather than export it, use find-tasks instead — it returns structured tasks rather than raw CSV. Nothing is modified.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    // `format` is defaulted here as well as in the schema: scripts/run-tool.ts calls
    // execute() with raw JSON, so schema defaults are not applied on that path.
    async execute({ projectId, format = 'file', useRelativeDates }, client) {
        if (format === 'url') {
            const { fileName, fileUrl } = await client.exportTemplateAsUrl({
                projectId,
                useRelativeDates,
            })

            return {
                textContent: `Exported project (id=${projectId}) as template URL: ${fileName}\n${fileUrl}`,
                structuredContent: { format, fileName, fileUrl },
            }
        }

        const content = await client.exportTemplateAsFile({ projectId, useRelativeDates })
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
    const summary = `Exported project (id=${projectId}) as a template file (${lines.length} row${lines.length === 1 ? '' : 's'}).`
    const preview = lines.slice(0, PREVIEW_LINE_COUNT).join('\n')
    const remaining = lines.length - PREVIEW_LINE_COUNT

    if (remaining > 0) {
        return `${summary}\n\n${preview}\n… ${remaining} more row${remaining === 1 ? '' : 's'} in the full content.`
    }

    return `${summary}\n\n${preview}`
}

export { exportProjectTemplate }
