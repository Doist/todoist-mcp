import type { SyncCommand, Task, TaskUpdateArgs } from '@todoist/sdk'
import { createCommand } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { mapTask } from '../tool-helpers.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { parseItemDuration } from '../utils/duration-parser.js'
import { FailureSchema, TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import { appendFailureSummary, summarizeTaskOperation } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { settleSyncCommands } from '../utils/sync-commands.js'
import { ToolNames } from '../utils/tool-names.js'

const TaskRescheduleSchema = z.object({
    id: z.string().min(1).describe('The ID of the task to reschedule.'),
    date: z
        .string()
        .min(1)
        .describe(
            'The new date for the task. Use YYYY-MM-DD for date-only, or YYYY-MM-DDTHH:MM:SS for datetime. ' +
                'If date-only is provided and the task already has a specific time, the existing time is preserved.',
        ),
    duration: z
        .string()
        .optional()
        .describe('Optional new duration, e.g. for time-blocking: "15m", "1h", "2h30m".'),
})

const ArgsSchema = {
    tasks: z
        .array(TaskRescheduleSchema)
        .min(1)
        .describe('The tasks to reschedule with their new dates.'),
}

const OutputSchema = {
    tasks: z.array(TaskOutputSchema).describe('The rescheduled tasks.'),
    totalCount: z.number().describe('The total number of tasks rescheduled.'),
    rescheduledTaskIds: z.array(z.string()).describe('The IDs of the rescheduled tasks.'),
    failures: z.array(FailureSchema).describe('Tasks that could not be rescheduled, with reasons.'),
}

const rescheduleTasks = {
    name: ToolNames.RESCHEDULE_TASKS,
    description:
        'Reschedule tasks to new dates while preserving recurring schedules. ' +
        'Unlike update-tasks (which replaces the entire due string and can wipe recurrence), ' +
        'this tool changes only the date (and duration, if given), keeping recurrence patterns intact. ' +
        'Use this when moving recurring tasks to a different date or time without altering their repeat pattern. ' +
        'Without a due date, the deadline moves.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        const { tasks: taskInputs } = args

        // Parse durations before any request, so a bad one changes nothing.
        const durations = taskInputs.map((input) =>
            input.duration ? parseItemDuration(`Task ${input.id}`, input.duration) : undefined,
        )

        const failures: Array<z.infer<typeof FailureSchema>> = []

        // Read each task's current due date, which the new date is built from.
        const fetched = await Promise.allSettled(
            taskInputs.map((input) => executeWithRetry(() => client.getTask(input.id))),
        )

        const toReschedule: Array<{ id: string; command: SyncCommand }> = []
        fetched.forEach((outcome, index) => {
            const input = taskInputs[index]
            if (!input) return
            if (outcome.status === 'rejected') {
                failures.push({ item: input.id, error: formatBatchItemError(outcome.reason) })
                return
            }
            const task = outcome.value
            const dateFields = buildRescheduleFields(input.date, task)
            // A task with neither date is not overdue; leave it alone.
            if (!dateFields) return
            toReschedule.push({
                id: input.id,
                command: createCommand('item_update', {
                    id: input.id,
                    ...dateFields,
                    ...(durations[index] && { duration: durations[index] }),
                }),
            })
        })

        const rescheduledIds: string[] = []
        if (toReschedule.length > 0) {
            // One Sync request; each command is settled on its own.
            const { outcomes } = await settleSyncCommands(
                client,
                toReschedule.map(({ command }) => command),
            )
            outcomes.forEach((outcome, index) => {
                const id = toReschedule[index]?.id ?? `Task ${index + 1}`
                if (outcome.status === 'fulfilled') {
                    rescheduledIds.push(id)
                } else {
                    failures.push({ item: id, error: formatBatchItemError(outcome.reason) })
                }
            })
        }

        logBatchFailures(ToolNames.RESCHEDULE_TASKS, taskInputs.length, failures)

        // The reschedules are already applied, so a failed read-back is reported, not thrown.
        // Each read is settled on its own so one failed read keeps the others.
        const mappedTasks: Array<z.infer<typeof TaskOutputSchema>> = []
        const unreadIds: string[] = []
        let readBackError: string | undefined
        if (rescheduledIds.length > 0) {
            const readBack = await Promise.allSettled(
                rescheduledIds.map((id) => executeWithRetry(() => client.getTask(id))),
            )
            // Mapping stays outside the settled reads: a task that fails to map is a
            // schema mismatch, which should still fail loudly.
            for (const [index, outcome] of readBack.entries()) {
                if (outcome.status === 'fulfilled') {
                    mappedTasks.push(mapTask(outcome.value))
                    continue
                }
                unreadIds.push(rescheduledIds[index] ?? `Task ${index + 1}`)
                readBackError ??= formatBatchItemError(outcome.reason)
            }
            if (readBackError) {
                console.error(`${ToolNames.RESCHEDULE_TASKS}: read-back failed`, {
                    updated: rescheduledIds.length,
                    unread: unreadIds.length,
                    error: readBackError,
                })
            }
        }

        const summary = readBackError
            ? `Rescheduled ${rescheduledIds.length} task${rescheduledIds.length === 1 ? '' : 's'}: ${rescheduledIds.join(', ')}\nCould not read back ${unreadIds.join(', ')}: ${readBackError}`
            : summarizeTaskOperation('Rescheduled', mappedTasks, {
                  showDetails: mappedTasks.length <= 5,
              })

        return {
            textContent: appendFailureSummary(summary, failures),
            structuredContent: {
                tasks: mappedTasks,
                totalCount: rescheduledIds.length,
                rescheduledTaskIds: rescheduledIds,
                failures,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

/**
 * The date a reschedule moves: the due date when there is one, else the deadline
 * (a deadline-only task is overdue by its deadline), else nothing.
 */
function buildRescheduleFields(
    inputDate: string,
    task: Pick<Task, 'due' | 'deadline'>,
): Pick<TaskUpdateArgs, 'due' | 'deadline'> | undefined {
    if (task.due) {
        return {
            due: {
                date: buildRescheduleDate(inputDate, task.due),
                string: task.due.string,
                isRecurring: task.due.isRecurring,
                timezone: task.due.timezone ?? undefined,
                lang: task.due.lang ?? undefined,
            },
        }
    }
    // Deadlines are date-only.
    if (task.deadline) {
        return { deadline: { date: inputDate.slice(0, 10) } }
    }
    return undefined
}

function buildRescheduleDate(inputDate: string, existingDue: NonNullable<Task['due']>): string {
    const isInputDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(inputDate)

    if (isInputDateOnly && existingDue.datetime) {
        // Preserve existing time when only a new date is provided
        const timePart = existingDue.datetime.substring(10)
        return inputDate + timePart
    }

    return inputDate
}

export { buildRescheduleDate, rescheduleTasks }
