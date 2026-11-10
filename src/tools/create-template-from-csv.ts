import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { colorSchemaWithDefault } from '../utils/colors.js'
import { executeCreateWithRetry, executeWithRetry } from '../utils/retry.js'
import {
    outlineTemplateContent,
    TemplateContentSchema,
    toSdkTemplateContent,
    toToolTemplateContent,
} from '../utils/template-content.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    csvFileContent: z
        .string()
        .min(1)
        .optional()
        .describe('The CSV content, e.g. from export-project-template or a file the user shared.'),
    preview: z
        .boolean()
        .optional()
        .describe(
            'Defaults to true: return the draft the CSV would create, without creating the template, to show the user and edit it first. Pass false to create it.',
        ),
    content: TemplateContentSchema.optional().describe(
        "With preview: false, create the template from this draft instead of the CSV: a preview's `content` with your edits, all of it. Anything left out isn't saved.",
    ),
    name: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('The name of the template. Required to save.'),
    description: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
            'Required to save. If the user gave none, write a one-sentence summary of the content.',
        ),
    color: colorSchemaWithDefault('Unrecognized colors are omitted. Defaults to charcoal.'),
}

const OutputSchema = {
    templateId: z.string().optional().describe('Absent for a preview.'),
    name: z.string().optional(),
    // Declared loosely to keep the tool surface small: it has the shape of the `content` input.
    content: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('The draft, for a preview. Edit it and send it back as `content` to save it.'),
}

const createTemplateFromCSV = {
    name: ToolNames.CREATE_TEMPLATE_FROM_CSV,
    description:
        "Create a reusable template in the user's Todoist from CSV content. By default it only returns the draft: ask the user whether to change anything, then save with preview: false, and `content` if it was edited. It is always a personal template, and task assignees are dropped; move it into a workspace with update-template. Each save creates a new template.",
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        title: 'Todoist: Create Template From CSV',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
    },
    async execute({ csvFileContent, preview, content, name, description, color }, client) {
        // The SDK treats strings as filesystem paths, not file content.
        const file = csvFileContent ? new Blob([csvFileContent], { type: 'text/csv' }) : undefined

        if (preview !== false) {
            if (content) {
                throw new Error(
                    'To create the template from `content`, pass preview: false. Nothing was created.',
                )
            }
            if (!file) {
                throw new Error('Provide `csvFileContent` to see the draft.')
            }
            const draft = toToolTemplateContent(
                (
                    await executeWithRetry(() =>
                        client.previewTemplateFromCSV({ file, fileName: 'template.csv' }),
                    )
                ).content,
            )
            return {
                textContent: `Draft of the CSV as a template, not created: ${outlineTemplateContent(draft)}\nBefore creating it, show the user this draft and ask whether to change anything. Then call create-template-from-csv again with preview: false, a name and description, and either the CSV or the edited \`content\`.`,
                structuredContent: { content: draft },
            }
        }

        if (file && content) {
            throw new Error('Provide either `csvFileContent` or an edited `content`, not both.')
        }
        if (!file && !content) {
            throw new Error('Provide `csvFileContent`, or the edited `content` from a preview.')
        }
        if (!name || !description) {
            throw new Error(
                'A name and a description are required to create the template. Leave out `preview` to see the draft first.',
            )
        }

        // Creates retry only a 503: after a 502 or 504 the template may already exist.
        const template = await executeCreateWithRetry(() =>
            client.createTemplateFromCSV({
                ...(content
                    ? { content: toSdkTemplateContent(content) }
                    : { file, fileName: 'template.csv' }),
                name,
                description,
                color: color ?? 'charcoal',
            }),
        )

        return {
            textContent: `Created template "${template.name}" (id=${template.id}) from ${content ? 'the edited draft' : 'CSV content'}. It is in your personal templates. Use create-project-from-template with this ID to start a new project from it.`,
            structuredContent: { templateId: template.id, name: template.name },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { createTemplateFromCSV }
