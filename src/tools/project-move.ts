import type {
    MoveProjectToWorkspaceArgs,
    PersonalProject,
    WorkspaceProject,
} from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapProject } from '../tool-helpers.js'
import { ProjectSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    action: z
        .enum(['move-to-workspace', 'move-to-personal'])
        .describe('The action to perform on the project.'),
    projectId: z.string().min(1).describe('The ID of the project to move.'),
    workspaceId: z
        .string()
        .min(1)
        .optional()
        .describe('The target workspace ID. Required when action is move-to-workspace.'),
    folderId: z
        .string()
        .min(1)
        .optional()
        .describe('Optional target folder ID within the workspace.'),
    visibility: z
        .enum(['restricted', 'team', 'public'])
        .optional()
        .describe(
            'Optional access visibility for the project in the workspace (restricted, team, or public).',
        ),
}

const OutputSchema = {
    project: ProjectSchema.describe('The moved project.'),
    success: z.boolean().describe('Whether the move was successful.'),
}

const projectMove = {
    name: ToolNames.PROJECT_MOVE,
    description: 'Move a project between personal and workspace contexts.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    // Destructive: move-to-personal removes every collaborator from the project.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async execute(args, client) {
        let project: PersonalProject | WorkspaceProject

        if (args.action === 'move-to-workspace') {
            if (!args.workspaceId) {
                throw new Error('workspaceId is required when action is move-to-workspace')
            }

            const moveArgs: MoveProjectToWorkspaceArgs = {
                projectId: args.projectId,
                workspaceId: args.workspaceId,
            }

            if (args.folderId) {
                moveArgs.folderId = args.folderId
            }

            if (args.visibility) {
                moveArgs.access = { visibility: args.visibility }
            }

            project = await client.moveProjectToWorkspace(moveArgs)
        } else {
            project = await client.moveProjectToPersonal({ projectId: args.projectId })
        }

        const mappedProject = mapProject(project)

        const actionText =
            args.action === 'move-to-workspace' ? 'Moved to workspace' : 'Moved to personal'

        return {
            textContent: `${actionText}: ${mappedProject.name} (id=${mappedProject.id})`,
            structuredContent: {
                project: mappedProject,
                success: true,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { projectMove }
