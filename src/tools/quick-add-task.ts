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
        'Create a single task from one free-form natural-language string using Todoist\'s Quick Add parser — the same syntax users type into the Todoist app. Parses everything inline: due date ("tomorrow at 5pm", recurring like "every Monday"), priority ("p1"–"p4"), labels ("@label"), project ("#Project Name"), section ("/Section Name"), assignee ("+name" or "+email"), and description (text after " // "). Project/section/assignee are resolved by **name** from the string, not by ID. Use this for one-off, user-style capture (e.g. relaying a message the user typed verbatim). Use **add-tasks** instead when you have structured fields, IDs, multiple tasks (up to 25), a deadline, a duration, or need precise control over assignment validation.',
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
