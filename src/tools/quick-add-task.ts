import type { QuickAddTaskArgs, TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function registerQuickAddTask(server: McpServer, api: TodoistApi) {
    server.tool(
        'quick-add-task',
        'Quickly add a task using natural language',
        {
            text: z
                .string()
                .describe(
                    'Task text with natural language parsing (e.g., "Call mom tomorrow at 5pm #personal @phone")',
                ),
            note: z.string().optional().describe('Additional note for the task'),
            reminder: z
                .string()
                .optional()
                .describe('When to be reminded of this task in natural language'),
            autoReminder: z
                .boolean()
                .optional()
                .default(false)
                .describe('Add default reminder for tasks with due times'),
        },
        async ({ text, note, reminder, autoReminder }) => {
            const args: QuickAddTaskArgs = {
                text,
            }

            if (note) args.note = note
            if (reminder) args.reminder = reminder
            if (autoReminder !== undefined) args.autoReminder = autoReminder

            const task = await api.quickAddTask(args)

            return {
                content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
            }
        },
    )
}
