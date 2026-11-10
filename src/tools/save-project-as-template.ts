import type { ColorKey, TodoistApi } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ColorKeySchema, colorSchemaWithDefault } from '../utils/colors.js'
import { executeCreateWithRetry, executeWithRetry } from '../utils/retry.js'
import {
    outlineTemplateContent,
    TemplateContentSchema,
    toSdkTemplateContent,
    toToolTemplateContent,
} from '../utils/template-content.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    projectId: z.string().min(1).describe('The project to save. It is copied, not changed.'),
    preview: z
        .boolean()
        .optional()
        .describe(
            'Defaults to true: return the draft without saving, to show the user and edit it first, as the app\'s "Save as template" editor does. Pass false to save.',
        ),
    content: TemplateContentSchema.optional().describe(
        "With preview: false, save this draft instead of the project as it is: a preview's `content` with your edits, all of it. Anything left out isn't saved.",
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
            'Required to save. If the user gave none, write a one-sentence summary of the project.',
        ),
    color: colorSchemaWithDefault(
        "Unrecognized colors are omitted and the project's color is used, which is also the default.",
    ),
    saveToWorkspace: z
        .boolean()
        .optional()
        .describe(
            "For a workspace project, save to the workspace's templates instead of the user's personal ones. Only workspace templates keep assignees. It starts unshared. Defaults to false.",
        ),
}

const OutputSchema = {
    templateId: z.string().optional().describe('Absent for a preview.'),
    name: z.string().optional(),
    workspaceId: z.string().optional().describe('Absent for personal templates.'),
    // Declared loosely to keep the tool surface small: it has the shape of the `content` input.
    content: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('The draft, for a preview. Edit it and send it back as `content` to save it.'),
}

const saveProjectAsTemplate = {
    name: ToolNames.SAVE_PROJECT_AS_TEMPLATE,
    description:
        'Save a project as a reusable template in the user\'s Todoist, like the app\'s "Save as template". By default it only returns the draft: ask the user whether to change anything, then save with preview: false, and `content` if it was edited. Each save creates a new template.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute(
        { projectId, preview, content, name, description, color, saveToWorkspace },
        client,
    ) {
        if (preview !== false) {
            if (content) {
                throw new Error('To save `content`, pass preview: false. Nothing was saved.')
            }
            const draft = toToolTemplateContent(
                (await executeWithRetry(() => client.previewProjectAsTemplate(projectId))).content,
            )
            return {
                textContent: `Draft of project (id=${projectId}) as a template, not saved: ${outlineTemplateContent(draft)}\nBefore saving, show the user this draft and ask whether to change anything. Then call save-project-as-template again with preview: false, a name and description, and the edited \`content\` if it changed.`,
                structuredContent: { content: draft },
            }
        }

        if (!name || !description) {
            throw new Error(
                'A name and a description are required to save the template. Leave out `preview` to see the draft without saving.',
            )
        }

        const templateColor = color ?? (await getProjectColor(client, projectId))

        // A create retries only a 503: after a 502 or 504 the template may already exist.
        const template = await executeCreateWithRetry(() =>
            client.saveProjectAsTemplate({
                projectId,
                name,
                description,
                color: templateColor,
                forWorkspace: saveToWorkspace,
                content: content ? toSdkTemplateContent(content) : undefined,
            }),
        )

        const workspaceId = template.workspaceId ?? undefined

        return {
            textContent: generateTextContent({
                projectId,
                templateId: template.id,
                name: template.name,
                workspaceId,
                shared: template.sharedWithWorkspaceMembers === true,
            }),
            structuredContent: {
                templateId: template.id,
                name: template.name,
                workspaceId,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

async function getProjectColor(client: TodoistApi, projectId: string): Promise<ColorKey> {
    const project = await executeWithRetry(() => client.getProject(projectId))
    const parsed = ColorKeySchema.safeParse(project.color)
    return parsed.success ? parsed.data : 'charcoal'
}

function generateTextContent({
    projectId,
    templateId,
    name,
    workspaceId,
    shared,
}: {
    projectId: string
    templateId: string
    name: string
    workspaceId: string | undefined
    shared: boolean
}) {
    const saved = `Saved project (id=${projectId}) as template "${name}" (id=${templateId}).`
    const sharing = shared ? 'shared with members' : 'not yet shared with members'
    const where = workspaceId
        ? ` It is in the workspace's templates (workspace id=${workspaceId}), ${sharing}.`
        : ' It is in your personal templates.'

    return `${saved}${where} Use create-project-from-template with this ID to start a new project from it.`
}

export { saveProjectAsTemplate }
