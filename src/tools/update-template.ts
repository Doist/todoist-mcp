import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ColorSchema } from '../utils/colors.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'
import { extractTemplateId } from './import-project-template.js'

const ArgsSchema = {
    templateId: z
        .string()
        .trim()
        .min(1)
        .describe('A saved template ID ("UT_28Ex...") or its Todoist URL.'),
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    color: ColorSchema,
    projectId: z
        .string()
        .min(1)
        .optional()
        .describe("Replace the template's content with this project's current content."),
    workspace: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
            'Workspace name or ID to move a personal template into. A workspace template cannot move again.',
        ),
    sharedWithWorkspaceMembers: z
        .boolean()
        .optional()
        .describe(
            'Share a workspace template with its members, or stop sharing it. Only the author can change this.',
        ),
}

const OutputSchema = {
    templateId: z.string(),
    name: z.string(),
    workspaceId: z.string().optional().describe('Absent for personal templates.'),
    sharedWithWorkspaceMembers: z.boolean(),
}

const updateTemplate = {
    name: ToolNames.UPDATE_TEMPLATE,
    description:
        'Update a saved Todoist template: rename it, change its description or color, replace its content from a project, move it into a workspace, or share it with workspace members. Omitted fields stay unchanged. Gallery templates cannot be edited.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    // Destructive: replacing the content overwrites it, and unsharing removes members' access.
    // Open world: sharing shows the template to other workspace members.
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
    },
    async execute(
        { templateId, name, description, color, projectId, workspace, sharedWithWorkspaceMembers },
        client,
    ) {
        const id = extractTemplateId(templateId)
        if (!id.startsWith('UT_')) {
            throw new Error(
                `"${id}" is a gallery template, which cannot be edited. Only saved templates (IDs starting with "UT_") can.`,
            )
        }

        if (
            [name, description, color, projectId, workspace, sharedWithWorkspaceMembers].every(
                (value) => value === undefined,
            )
        ) {
            throw new Error('Nothing to update. Provide at least one field to change.')
        }

        const workspaceId = workspace
            ? (await executeWithRetry(() => workspaceResolver.resolveWorkspace(client, workspace)))
                  .workspaceId
            : undefined

        const template = await client.updateUserTemplate(id, {
            name,
            description,
            color,
            projectId,
            workspaceId,
            sharedWithWorkspaceMembers,
        })

        const resultWorkspaceId = template.workspaceId ?? undefined
        const shared = template.sharedWithWorkspaceMembers ?? false
        const where = resultWorkspaceId
            ? ` It is in workspace (id=${resultWorkspaceId}) and ${shared ? 'shared with' : 'not shared with'} its members.`
            : ' It is a personal template.'

        return {
            textContent: `Updated template "${template.name}" (id=${template.id}).${where}`,
            structuredContent: {
                templateId: template.id,
                name: template.name,
                workspaceId: resultWorkspaceId,
                sharedWithWorkspaceMembers: shared,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { updateTemplate }
