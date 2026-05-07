import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapTask } from '../tool-helpers.js'
import { TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import { summarizeTaskOperation } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    text: z
        .string()
        .min(1)
        .describe(
            'The full task as one natural-language string using Todoist\'s Quick Add syntax. Inline tokens: due date ("tomorrow at 5pm", recurring "every Monday"), priority ("p1"–"p4"), labels ("@label"), project ("#Project Name"), section ("/Section Name"), assignee ("+name" or "+email"), description (text after " // "), and reminders ("!30m" / "!1h" before due, or "!2025-12-31 at 9am").',
        ),
    autoReminder: z
        .boolean()
        .optional()
        .describe(
            "If true, automatically attach a reminder based on the parsed due date (uses the user's default reminder preference). Defaults to the Todoist API default.",
        ),
}

const OutputSchema = {
    task: TaskOutputSchema.describe('The created task.'),
}

const quickAddTask = {
    name: ToolNames.QUICK_ADD_TASK,
    description:
        'Create a single task from one free-form natural-language string using Todoist\'s Quick Add parser — the same syntax users type into the Todoist app. Everything is inline in the `text` field: due date ("tomorrow at 5pm", recurring like "every Monday"), priority ("p1"–"p4"), labels ("@label"), project ("#Project Name"), section ("/Section Name"), assignee ("+name" or "+email"), description (text after " // "), and reminders ("!30m" / "!1h" before due, or "!2025-12-31 at 9am"). Project/section/assignee are resolved by **name**, not ID. Use this for one-off, user-style capture (especially relaying something the user typed verbatim, or when reminders are part of the input). Use **add-tasks** instead when you have structured fields, IDs, multiple tasks (up to 25), a deadline, a duration, or need precise control over assignment validation.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute(args, client) {
        const { text, autoReminder } = z.object(ArgsSchema).parse(args)

        const created = await client.quickAddTask({ text, autoReminder })
        const mapped = mapTask(created)

        return {
            textContent: summarizeTaskOperation('Added', [mapped], { showDetails: true }),
            structuredContent: { task: mapped },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { quickAddTask }
