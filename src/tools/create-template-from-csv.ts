import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { colorSchemaWithDefault } from '../utils/colors.js'
import { executeCreateWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    csvFileContent: z
        .string()
        .min(1)
        .describe('The CSV content, e.g. from export-project-template or a file the user shared.'),
    name: z.string().trim().min(1).describe('The name of the template.'),
    description: z
        .string()
        .trim()
        .min(1)
        .describe('Required. If the user gave none, write a one-sentence summary of the content.'),
    color: colorSchemaWithDefault('Unrecognized colors are omitted. Defaults to charcoal.'),
}

const OutputSchema = {
    templateId: z.string(),
    name: z.string(),
}

const createTemplateFromCSV = {
    name: ToolNames.CREATE_TEMPLATE_FROM_CSV,
    description:
        "Create a reusable template in the user's Todoist from CSV content. It is always a personal template, and task assignees are dropped; move it into a workspace with update-template. Each call creates a new one.",
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ csvFileContent, name, description, color }, client) {
        // Creates retry only a 503: after a 502 or 504 the template may already exist.
        const template = await executeCreateWithRetry(() =>
            client.createTemplateFromCSV({
                // The SDK treats strings as filesystem paths, not file content.
                file: new Blob([csvFileContent], { type: 'text/csv' }),
                fileName: 'template.csv',
                name,
                description,
                color: color ?? 'charcoal',
            }),
        )

        return {
            textContent: `Created template "${template.name}" (id=${template.id}) from CSV content. It is in your personal templates. Use create-project-from-template with this ID to start a new project from it.`,
            structuredContent: { templateId: template.id, name: template.name },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { createTemplateFromCSV }
