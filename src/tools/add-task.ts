import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function registerAddTask(server: McpServer, api: TodoistApi) {
    server.tool(
        'add-task',
        'Add a task to Todoist',
        {
            content: z.string(),
            description: z.string().optional(),
            projectId: z.string().optional().describe('The ID of a project to add the task to'),
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
            parentId: z.string().optional().describe('The ID of a parent task'),
            deadlineDate: z
                .string()
                .optional()
                .describe('Specific date in YYYY-MM-DD format relative to user’s timezone.'),
            deadlineLang: z
                .string()
                .optional()
                .describe('2-letter code specifying language of deadline.'),
            dueString: z
                .string()
                .optional()
                .describe('Natural language description of due date like "tomorrow at 3pm"'),
            dueDate: z
                .string()
                .optional()
                .describe('Specific date in YYYY-MM-DD format relative to user's timezone'),
            dueDatetime: z
                .string()
                .optional()
                .describe('Full ISO datetime format like "2023-12-31T15:00:00Z"'),
            dueLang: z
                .string()
                .optional()
                .describe('2-letter code specifying language of due date'),
            duration: z
                .number()
                .optional()
                .describe('Duration of the task'),
            durationUnit: z
                .string()
                .optional()
                .describe('Unit for task duration (e.g., "minute", "hour", "day")'),
        },
        async ({
            content,
            projectId,
            parentId,
            assigneeId,
            priority,
            labels,
            deadlineDate,
            deadlineLang,
            dueString,
            dueDate,
            dueDatetime,
            dueLang,
            duration,
            durationUnit,
        }) => {
            const task = await api.addTask({
                content,
                projectId,
                parentId,
                assigneeId,
                priority,
                labels,
                deadlineDate,
                deadlineLang,
                dueString,
                dueDate,
                dueDatetime,
                dueLang,
                duration,
                durationUnit,
            })
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(task, null, 2),
                    },
                ],
            }
        },
    )
}
