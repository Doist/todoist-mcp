import type { Project, TodoistApi } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { getProjectOrExplain, isPersonalProject, mapProject } from '../tool-helpers.js'
import { ProjectSchema } from '../utils/output-schemas.js'
import {
    assertPersonalProjectCapacity,
    loadPersonalProjectCapacity,
} from '../utils/personal-project-limit.js'
import { ToolNames } from '../utils/tool-names.js'

const { FIND_PROJECTS } = ToolNames

const ArgsSchema = {
    action: z
        .enum(['archive', 'unarchive', 'join'])
        .describe('The action to perform on the project.'),
    projectId: z.string().min(1).describe('The ID of the project.'),
}

const OutputSchema = {
    project: ProjectSchema.describe('The updated project.'),
    success: z.boolean().describe('Whether the action was successful.'),
}

const PAST_TENSE = {
    archive: 'Archived',
    unarchive: 'Unarchived',
    join: 'Joined',
} as const

const projectManagement = {
    name: ToolNames.PROJECT_MANAGEMENT,
    description: `Archive or unarchive a project by its ID, or join a workspace project the user hasn't joined (see ${FIND_PROJECTS} includeUnjoined) when they ask to.`,
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const project = await performAction(args, client)
        const mappedProject = mapProject(project)

        return {
            textContent: `${PAST_TENSE[args.action]} project: ${mappedProject.name} (id=${mappedProject.id})`,
            structuredContent: {
                project: mappedProject,
                success: true,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

async function performAction(
    { action, projectId }: z.infer<z.ZodObject<typeof ArgsSchema>>,
    client: TodoistApi,
): Promise<Project> {
    switch (action) {
        case 'archive':
            return client.archiveProject(projectId)
        case 'unarchive': {
            // Unarchiving a personal project makes it count towards the plan limit again.
            const archived = await getProjectOrExplain(client, projectId)
            if (isPersonalProject(archived) && archived.isArchived) {
                assertPersonalProjectCapacity(
                    await loadPersonalProjectCapacity(client, ToolNames.PROJECT_MANAGEMENT),
                    'This project was not unarchived.',
                )
            }
            return client.unarchiveProject(projectId)
        }
        case 'join': {
            const { project } = await client.joinProject(projectId)
            return project
        }
    }
}

export { projectManagement }
