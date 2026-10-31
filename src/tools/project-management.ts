import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { isPersonalProject, mapProject } from '../tool-helpers.js'
import { ProjectSchema } from '../utils/output-schemas.js'
import {
    assertPersonalProjectCapacity,
    loadPersonalProjectCapacity,
} from '../utils/personal-project-limit.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    action: z.enum(['archive', 'unarchive']).describe('The action to perform on the project.'),
    projectId: z.string().min(1).describe('The ID of the project.'),
}

const OutputSchema = {
    project: ProjectSchema.describe('The updated project.'),
    success: z.boolean().describe('Whether the action was successful.'),
}

const projectManagement = {
    name: ToolNames.PROJECT_MANAGEMENT,
    description: 'Archive or unarchive a project by its ID.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        if (args.action === 'unarchive') {
            // Unarchiving a personal project makes it count towards the plan limit again.
            const archived = await client.getProject(args.projectId)
            if (isPersonalProject(archived) && archived.isArchived) {
                assertPersonalProjectCapacity(
                    await loadPersonalProjectCapacity(client, ToolNames.PROJECT_MANAGEMENT),
                    'This project was not unarchived.',
                )
            }
        }

        const project =
            args.action === 'archive'
                ? await client.archiveProject(args.projectId)
                : await client.unarchiveProject(args.projectId)

        const mappedProject = mapProject(project)

        return {
            textContent: `${args.action === 'archive' ? 'Archived' : 'Unarchived'} project: ${mappedProject.name} (id=${mappedProject.id})`,
            structuredContent: {
                project: mappedProject,
                success: true,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { projectManagement }
