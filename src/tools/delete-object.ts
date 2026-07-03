import { createCommand, isWorkspaceProject } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const entityTypes = [
    'project',
    'section',
    'task',
    'comment',
    'label',
    'filter',
    'reminder',
    'location_reminder',
] as const

const ArgsSchema = {
    type: z.enum(entityTypes).describe('The type of entity to delete.'),
    id: z.string().min(1).describe('The ID of the entity to delete.'),
}

const OutputSchema = {
    deletedEntity: z
        .object({
            type: z.enum(entityTypes).describe('The type of deleted entity.'),
            id: z.string().describe('The ID of the deleted entity.'),
        })
        .describe('Information about the deleted entity.'),
    success: z.boolean().describe('Whether the deletion was successful.'),
}

const deleteObject = {
    name: ToolNames.DELETE_OBJECT,
    description:
        'Delete a project, section, task, comment, label, filter, reminder, or location_reminder by its ID. Projects can be deleted whether active or archived (find archived ones via find-projects with archivedStatus); note a workspace project must be archived before it can be deleted, while personal projects can be deleted regardless.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async execute(args, client) {
        switch (args.type) {
            case 'project': {
                const project = await client.getProject(args.id)
                if (isWorkspaceProject(project) && !project.isArchived) {
                    throw new Error(
                        `Workspace project "${project.name}" must be archived before it can be deleted. Archive the project first, then delete it.`,
                    )
                }
                await client.deleteProject(args.id)
                break
            }
            case 'section':
                await client.deleteSection(args.id)
                break
            case 'task':
                await client.deleteTask(args.id)
                break
            case 'comment':
                await client.deleteComment(args.id)
                break
            case 'label':
                await client.deleteLabel(args.id)
                break
            case 'filter':
                await client.sync({
                    commands: [createCommand('filter_delete', { id: args.id })],
                })
                break
            case 'reminder':
                await client.deleteReminder(args.id)
                break
            case 'location_reminder':
                await client.deleteLocationReminder(args.id)
                break
        }

        return {
            textContent: `Deleted ${args.type}: id=${args.id}`,
            structuredContent: {
                deletedEntity: { type: args.type, id: args.id },
                success: true,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { deleteObject }
