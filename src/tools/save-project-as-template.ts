import type { ColorKey } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ColorKeySchema, ColorSchema } from '../utils/colors.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    projectId: z.string().min(1).describe('The project to save. It is copied, not changed.'),
    name: z.string().trim().min(1).describe('The name of the template.'),
    description: z
        .string()
        .trim()
        .min(1)
        .describe('Required. If the user gave none, write a one-sentence summary of the project.'),
    color: ColorSchema.describe("Defaults to the project's color."),
    saveToWorkspace: z
        .boolean()
        .optional()
        .describe(
            "For a workspace project, save to the workspace's templates instead of the user's personal ones. Only workspace templates keep assignees. It starts unshared. Defaults to false.",
        ),
}

const OutputSchema = {
    templateId: z.string(),
    name: z.string(),
    workspaceId: z.string().optional().describe('Absent for personal templates.'),
}

const saveProjectAsTemplate = {
    name: ToolNames.SAVE_PROJECT_AS_TEMPLATE,
    description:
        'Save a project as a reusable template in the user\'s Todoist, like the app\'s "Save as template". Each call saves a new one.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ projectId, name, description, color, saveToWorkspace }, client) {
        const templateColor = color ?? (await getProjectColor(client, projectId))

        const template = await client.createUserTemplate({
            projectId,
            name,
            description,
            color: templateColor,
            forWorkspace: saveToWorkspace,
        })

        const workspaceId = template.workspaceId ?? undefined

        return {
            textContent: generateTextContent({
                projectId,
                templateId: template.id,
                name: template.name,
                workspaceId,
            }),
            structuredContent: {
                templateId: template.id,
                name: template.name,
                workspaceId,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

async function getProjectColor(
    client: Parameters<typeof saveProjectAsTemplate.execute>[1],
    projectId: string,
): Promise<ColorKey> {
    const project = await executeWithRetry(() => client.getProject(projectId))
    const parsed = ColorKeySchema.safeParse(project.color)
    return parsed.success ? parsed.data : 'charcoal'
}

function generateTextContent({
    projectId,
    templateId,
    name,
    workspaceId,
}: {
    projectId: string
    templateId: string
    name: string
    workspaceId: string | undefined
}) {
    const saved = `Saved project (id=${projectId}) as template "${name}" (id=${templateId}).`
    const where = workspaceId
        ? ` It is in the workspace's templates (workspace id=${workspaceId}), not yet shared with members.`
        : ' It is in your personal templates.'

    return `${saved}${where} Use create-project-from-template with this ID to start a new project from it.`
}

export { saveProjectAsTemplate }
