import type { MoveTaskArgs, TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function registerMoveTasks(server: McpServer, api: TodoistApi) {
    server.tool(
        'move-tasks',
        'Move multiple tasks to a project, section, or parent task',
        {
            taskIds: z.array(z.string()).describe('Array of task IDs to move'),
            projectId: z.string().optional().describe('Project ID to move tasks to'),
            sectionId: z.string().optional().describe('Section ID to move tasks to'),
            parentId: z.string().optional().describe('Parent task ID to move tasks under'),
        },
        async ({ taskIds, projectId, sectionId, parentId }) => {
            // Ensure only one destination is specified
            const destinationCount = [projectId, sectionId, parentId].filter(Boolean).length
            if (destinationCount !== 1) {
                throw new Error(
                    'You must specify exactly one of: projectId, sectionId, or parentId',
                )
            }

            // Create the move arguments - exactly one is required
            let moveArgs: MoveTaskArgs

            if (projectId) {
                moveArgs = { projectId }
            } else if (sectionId) {
                moveArgs = { sectionId }
            } else if (parentId) {
                moveArgs = { parentId }
            } else {
                // This should never happen due to the earlier validation
                throw new Error(
                    'You must specify exactly one of: projectId, sectionId, or parentId',
                )
            }

            // Move the tasks
            const movedTasks = await api.moveTasks(taskIds, moveArgs)

            return {
                content: [{ type: 'text', text: JSON.stringify(movedTasks, null, 2) }],
            }
        },
    )
}
