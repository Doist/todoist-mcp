import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapTask } from '../tool-helpers.js'
import { TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    text: z
        .string()
        .min(1)
        .describe(
            'The full task text using Todoist\'s natural-language syntax. Supports inline date ("tomorrow at 5pm"), priority ("p1"), labels ("@work"), project ("#Inbox"), and assignee ("+Alice").',
        ),
    note: z.string().optional().describe('Optional note/description to attach to the new task.'),
    reminder: z
        .string()
        .optional()
        .describe(
            'Optional reminder for the task, in natural language (e.g. "30 minutes before").',
        ),
    autoReminder: z
        .boolean()
        .optional()
        .describe('Whether to automatically add a reminder based on the parsed due date.'),
}

const OutputSchema = {
    task: TaskOutputSchema.describe('The created task.'),
}

const quickAddTask = {
    name: ToolNames.QUICK_ADD_TASK,
    description:
        'Create a single task using Todoist\'s natural-language quick-add syntax. The full task (content, due date, priority, labels, project, assignee) is parsed from a single text string — e.g. "Review PR tomorrow at 5pm #Work @urgent p1". Use add-tasks for structured/bulk creation.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute(args, client) {
        const { text, note, reminder, autoReminder } = z.object(ArgsSchema).parse(args)

        const created = await client.quickAddTask({
            text,
            note,
            reminder,
            autoReminder,
        })

        const mapped = mapTask(created)

        return {
            textContent: `Created task "${mapped.content}" (id: ${mapped.id}).`,
            structuredContent: { task: mapped },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { quickAddTask }
