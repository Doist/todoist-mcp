import type { TodoistApi } from '@doist/todoist-api-typescript'
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
                .describe('Natural language for the due date (e.g., "today at 10am")'),
            dueLang: z
                .string()
                .optional()
                .describe('2-letter code specifying language of due date'),
            dueDate: z.string().optional().describe('Specific date in YYYY-MM-DD format'),
            dueDateTime: z
                .string()
                .optional()
                .describe(
                    'Specific date and time in RFC3339 format (e.g., "2025-05-06T15:40:00Z")',
                ),
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
            dueDateTime,
        }) => {
            //Update task requires dueDate or dueDateTime.
            //If only dueDate is provided, use it as dueDateTime.
            if (dueDate && !dueDateTime) {
                dueDateTime = dueDate
            }

            const task = await api.updateTask(taskId, {
                content,
                description,
                assigneeId,
                priority,
                labels,
                dueString,
                dueLang,
                dueDatetime: dueDateTime ?? '',
            })

            return {
                content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
            }
        },
    )
}
