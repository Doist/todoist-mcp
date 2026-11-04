import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import {
    assertPersonalProjectCapacity,
    loadPersonalProjectCapacity,
} from '../utils/personal-project-limit.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'
import { extractTemplateId } from './import-project-template.js'

const ArgsSchema = {
    templateId: z
        .string()
        .trim()
        .min(1)
        .describe(
            'A gallery slug ("product-launch"), a saved template ID ("UT_28Ex..."), or a Todoist template URL.',
        ),
    name: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("The name of the new project. Defaults to the template's name."),
    workspace: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
            'Workspace name or ID to create the project in. Omit for a personal project. Workspace templates only work in their own workspace.',
        ),
    folderId: z
        .string()
        .min(1)
        .optional()
        .describe('The folder to create the project in. Requires `workspace`.'),
    locale: z
        .string()
        .optional()
        .describe('Language of gallery template content, e.g. "de". Defaults to "en".'),
}

const OutputSchema = {
    projectId: z.string().describe('The ID of the new project.'),
    projectName: z.string().optional().describe('Absent if the project could not be read back.'),
}

const createProjectFromTemplate = {
    name: ToolNames.CREATE_PROJECT_FROM_TEMPLATE,
    description:
        'Create a new project from a Todoist template, with its sections, tasks and comments. To add a template to an existing project, use import-project-template.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ templateId, name, workspace, folderId, locale }, client) {
        if (folderId && !workspace) {
            throw new Error(
                'Folders only exist in workspaces. Pass `workspace` along with `folderId`, or leave out `folderId` to create a personal project.',
            )
        }

        const resolvedTemplateId = extractTemplateId(templateId)

        let workspaceId: string | undefined
        if (workspace) {
            ;({ workspaceId } = await executeWithRetry(() =>
                workspaceResolver.resolveWorkspace(client, workspace),
            ))
        } else {
            assertPersonalProjectCapacity(
                await loadPersonalProjectCapacity(client, ToolNames.CREATE_PROJECT_FROM_TEMPLATE),
                'The project was not created.',
            )
        }

        const { projectId } = await client.createProjectFromTemplateId({
            templateId: resolvedTemplateId,
            name,
            locale,
            workspaceId,
            folderId,
        })

        // The endpoint only returns the new ID. The project exists either way, so a
        // failed read must not turn the creation into an error a caller would retry.
        let projectName: string | undefined
        try {
            ;({ name: projectName } = await executeWithRetry(() => client.getProject(projectId)))
        } catch (error) {
            console.error(
                `${ToolNames.CREATE_PROJECT_FROM_TEMPLATE}: could not read back project ${projectId}`,
                error,
            )
        }

        const label = projectName ? `"${projectName}" (id=${projectId})` : `(id=${projectId})`

        return {
            textContent: `Created project ${label} from template ${resolvedTemplateId}.`,
            structuredContent: { projectId, projectName },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { createProjectFromTemplate }
