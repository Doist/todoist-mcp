import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ColorKeySchema, ColorOutputSchema } from '../utils/colors.js'
import { executeWithRetry } from '../utils/retry.js'
import { type ToolTemplateContent, toToolTemplateContent } from '../utils/template-content.js'
import { ToolNames } from '../utils/tool-names.js'
import { extractTemplateId } from './import-project-template.js'

const ArgsSchema = {
    templateId: z
        .string()
        .trim()
        .min(1)
        .describe(
            'A gallery slug ("product-launch"), a saved template ID ("UT_28Ex..."), or a Todoist template URL.',
        ),
    locale: z
        .string()
        .optional()
        .describe('Language of gallery template content, e.g. "de". Defaults to "en".'),
}

const OutputSchema = {
    templateId: z.string(),
    name: z.string(),
    description: z.string(),
    color: ColorOutputSchema,
    source: z
        .enum(['todoist', 'user'])
        .describe('todoist for gallery templates, user for saved ones.'),
    workspaceId: z.string().optional().describe('Absent for personal and gallery templates.'),
    sharedWithWorkspaceMembers: z.boolean().optional(),
    canEdit: z.boolean().describe('Whether update-template can change it.'),
    // Declared loosely to keep the tool surface small; update-template's `content` input
    // documents the full shape, which is what get-template returns.
    content: z
        .record(z.string(), z.unknown())
        .describe("The template's content, in the shape update-template's `content` takes."),
}

const MAX_LISTED_TASKS = 20

const getTemplate = {
    name: ToolNames.GET_TEMPLATE,
    description:
        "Get a template's details and full content: layout, sections, tasks and comments. To edit a saved template's content, change this content and send all of it back to update-template as `content`.",
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute({ templateId, locale }, client) {
        const id = extractTemplateId(templateId)
        const [template, { content }] = await Promise.all([
            executeWithRetry(() => client.getTemplate(id, { locale })),
            executeWithRetry(() => client.getTemplateContent(id, { locale })),
        ])
        const toolContent = toToolTemplateContent(content)

        return {
            textContent: generateTextContent(template.name, template.id, toolContent),
            structuredContent: {
                templateId: template.id,
                name: template.name,
                description: template.longDescription,
                color: ColorKeySchema.safeParse(template.templateColor).data,
                source: template.templateSource,
                workspaceId: template.workspaceId ?? undefined,
                sharedWithWorkspaceMembers: template.sharedWithWorkspaceMembers,
                canEdit: template.canEdit ?? false,
                content: toolContent,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent(name: string, id: string, content: ToolTemplateContent): string {
    const layout = content.projects[0]?.viewStyle ?? 'list'
    const sectionNames = new Map(content.sections.map((section) => [section.id, section.name]))
    const header = `Template "${name}" (id=${id}): ${layout} layout, ${content.sections.length} section${content.sections.length === 1 ? '' : 's'}, ${content.tasks.length} task${content.tasks.length === 1 ? '' : 's'}.`

    const lines = content.tasks.slice(0, MAX_LISTED_TASKS).map((task) => {
        const indent = task.parentId ? '    ' : ''
        const section = task.sectionId
            ? ` [${sectionNames.get(task.sectionId) ?? task.sectionId}]`
            : ''
        const due = task.due ? ` (due ${task.due.string})` : ''
        return `${indent}- ${task.content}${section}${due}`
    })
    const remaining = content.tasks.length - MAX_LISTED_TASKS
    if (remaining > 0) {
        lines.push(`… ${remaining} more task${remaining === 1 ? '' : 's'} in the full content.`)
    }

    return [header, ...lines].join('\n')
}

export { getTemplate }
