import type { TodoistApi, UpdateTaskArgs } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function registerUpdateTask(server: McpServer, api: TodoistApi) {
    server.tool(
        'update-task',
        'Update a task in Todoist',
        {
            taskId: z.string(),
            content: z.string().optional(),
            description: z.string().optional(),
            assigneeId: z
                .string()
                .optional()
                .describe('The ID of a project collaborator to assign the task to'),
            priority: z
                .number()
                .min(1)
                .max(4)
                .optional()
                .describe('Task priority from 1 (normal) to 4 (urgent)'),
            labels: z.array(z.string()).optional(),
            dueString: z
                .string()
                .optional()
                .describe('Natural language description of due date like "tomorrow at 3pm"'),
            dueLang: z
                .string()
                .optional()
                .describe('2-letter code specifying language of due date'),
            dueDate: z
                .string()
                .optional()
                .describe("Specific date in YYYY-MM-DD format relative to user's timezone"),
            dueDatetime: z
                .string()
                .optional()
                .describe('Full ISO datetime format like "2023-12-31T15:00:00Z"'),
            deadlineDate: z
                .string()
                .optional()
                .describe("Specific date in YYYY-MM-DD format relative to user's timezone."),
            deadlineLang: z
                .string()
                .optional()
                .describe('2-letter code specifying language of deadline.'),
            duration: z
                .number()
                .optional()
                .describe('Duration of the task (must be provided with durationUnit)'),
            durationUnit: z
                .enum(['minute', 'day'])
                .optional()
                .describe('Unit for task duration (must be provided with duration)'),
        },
        async ({
            taskId,
            content,
            description,
            assigneeId,
            priority,
            labels,
            dueString,
            dueLang,
            dueDate,
            dueDatetime,
            deadlineDate,
            deadlineLang,
            duration,
            durationUnit,
        }) => {
            // Validate that dueDate and dueDatetime are not both provided
            if (dueDate && dueDatetime) {
                throw new Error('Cannot provide both dueDate and dueDatetime')
            }

            // Validate that if duration or durationUnit is provided, both must be provided
            if ((duration && !durationUnit) || (!duration && durationUnit)) {
                throw new Error('Must provide both duration and durationUnit, or neither')
            }

            // Create base update args
            const baseArgs = {
                content,
                description,
                assigneeId,
                priority,
                labels,
                dueString,
                dueLang,
                deadlineDate,
                deadlineLang,
            }

            // Handle due date (can only have one of dueDate or dueDatetime)
            let updateArgs: Partial<UpdateTaskArgs> = {}
            if (dueDate) {
                updateArgs = { ...baseArgs, dueDate }
            } else if (dueDatetime) {
                updateArgs = { ...baseArgs, dueDatetime }
            } else {
                updateArgs = baseArgs
            }

            // Handle duration (must have both or neither)
            if (duration !== undefined && durationUnit !== undefined) {
                updateArgs = { ...updateArgs, duration, durationUnit }
            }

            const task = await api.updateTask(taskId, updateArgs as UpdateTaskArgs)

            return {
                content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
            }
        },
    )
}
