import type { Task, TodoistApi, UpdateTaskArgs } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { createMoveTaskArgs, mapTask, resolveInboxProjectId } from '../tool-helpers.js'
import { assignmentValidator } from '../utils/assignment-validator.js'
import { DisplayLimits } from '../utils/constants.js'
import { DurationParseError, parseDuration } from '../utils/duration-parser.js'
import { FailureSchema, TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import {
    convertPriorityToNumber,
    PRIORITY_INPUT_DESCRIPTION,
    PrioritySchema,
} from '../utils/priorities.js'
import { summarizeTaskOperation } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const TasksUpdateSchema = z.object({
    id: z.string().min(1).describe('The ID of the task to update.'),
    content: z
        .string()
        .optional()
        .describe(
            'The new task name/title. Should be concise and actionable (e.g., "Review PR #123", "Call dentist"). For longer content, use the description field instead. Supports Markdown.',
        ),
    description: z
        .string()
        .optional()
        .describe(
            'New additional details, notes, or context for the task. Use this for longer content rather than putting it in the task name. Supports Markdown.',
        ),
    projectId: z
        .string()
        .optional()
        .describe(
            'The new project ID for the task. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
    sectionId: z.string().optional().describe('The new section ID for the task.'),
    parentId: z.string().optional().describe('The new parent task ID (for subtasks).'),
    order: z.number().optional().describe('The new order of the task within its parent/section.'),
    priority: PrioritySchema.optional().describe(PRIORITY_INPUT_DESCRIPTION),
    dueString: z
        .preprocess(
            // Keep accepting legacy null while exposing a Gemini-compatible string schema.
            (value) => (value === null ? 'remove' : value),
            z
                .string()
                .describe(
                    'The new due date for the task in natural language (e.g., "tomorrow at 5pm"). Use "remove" to clear the due date.',
                ),
        )
        .optional(),
    deadlineDate: z
        .preprocess(
            // Keep accepting legacy null while exposing a Gemini-compatible string schema.
            (value) => (value === null ? 'remove' : value),
            z
                .string()
                .describe(
                    'The new deadline date for the task in ISO 8601 format (YYYY-MM-DD, e.g., "2025-12-31"). Deadlines are immovable constraints shown with a different indicator than due dates. Use "remove" to clear the deadline.',
                ),
        )
        .optional(),
    duration: z
        .string()
        .optional()
        .describe(
            'The duration of the task. Use format: "2h" (hours), "90m" (minutes), "2h30m" (combined), or "1.5h" (decimal hours). Max 24h.',
        ),
    responsibleUser: z
        .string()
        .optional()
        .describe(
            'Change task assignment. Use "unassign" to remove assignment. Can be "me" (assigns to current user), a user ID, name, or email. User must be a project collaborator.',
        ),
    labels: z
        .array(z.string())
        .optional()
        .describe('The new labels for the task. Replaces all existing labels.'),
    isUncompletable: z
        .boolean()
        .optional()
        .describe(
            'Whether this task should be uncompletable (organizational header). Tasks with isUncompletable: true appear as organizational headers and cannot be completed.',
        ),
})

type TaskUpdate = z.infer<typeof TasksUpdateSchema>

const DUE_DATE_REMOVAL_ALIASES = ['remove', 'no date'] as const
const DEADLINE_REMOVAL_ALIASES = ['remove', 'no date', 'no deadline'] as const
const DUE_DATE_REMOVAL_VALUE = 'no date' as const

// Cap the batch size (matching add-tasks) so a single call can't fan out an unbounded
// number of concurrent SDK requests or buffer an unbounded failures response.
const MAX_TASKS_PER_OPERATION = 25

const ArgsSchema = {
    tasks: z
        .array(TasksUpdateSchema)
        .min(1)
        .max(MAX_TASKS_PER_OPERATION)
        .describe(`The tasks to update (max ${MAX_TASKS_PER_OPERATION}).`),
}

const OutputSchema = {
    tasks: z.array(TaskOutputSchema).describe('The updated tasks.'),
    totalCount: z.number().describe('The total number of tasks updated.'),
    updatedTaskIds: z.array(z.string()).describe('The IDs of the updated tasks.'),
    failures: z
        .array(FailureSchema)
        .describe(
            'Tasks that could not be updated, with the reason for each. A failure here does not affect the other tasks in the batch.',
        ),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('The number of tasks actually updated.'),
            skippedCount: z.number().describe('The number of tasks skipped (no changes).'),
            failureCount: z.number().describe('The number of tasks that failed to update.'),
        })
        .describe('Summary of operations performed.'),
}

const updateTasks = {
    name: ToolNames.UPDATE_TASKS,
    description: 'Update existing tasks including content, dates, priorities, and assignments.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        const { tasks } = args

        // Each task is updated independently. A failure on one task (for example, the
        // API rejecting a move with "Not allowed to move objects out of a workspace")
        // must not discard the successful updates in the same batch, nor surface as a
        // single opaque batch error that nudges the caller into retrying everything —
        // a retry loop that can trip server-side abuse penalties. So we settle every
        // task and report per-task outcomes.
        const settled = await Promise.allSettled(
            tasks.map((task) => processTaskUpdate(task, client)),
        )

        const updatedTasks: Task[] = []
        const failures: Array<{ item: string; error: string }> = []
        let skippedCount = 0

        for (const [index, result] of settled.entries()) {
            if (result.status === 'fulfilled') {
                if (result.value === undefined) {
                    skippedCount++
                } else {
                    updatedTasks.push(result.value)
                }
                continue
            }

            failures.push({
                item: tasks[index]?.id ?? `Task ${index + 1}`,
                error:
                    result.reason instanceof Error ? result.reason.message : String(result.reason),
            })
        }

        // Never throw for per-item problems — even when every task fails. Returning the
        // structured result (empty `tasks`, populated `failures`) keeps total and partial
        // failures uniform and preserves the per-item reason for each task, rather than
        // collapsing them into one opaque error.
        const mappedTasks = updatedTasks.map(mapTask)

        const textContent = generateTextContent({
            tasks: mappedTasks,
            failures,
            skippedCount,
        })

        return {
            textContent,
            structuredContent: {
                tasks: mappedTasks,
                totalCount: mappedTasks.length,
                updatedTaskIds: updatedTasks.map((task) => task.id),
                failures,
                appliedOperations: {
                    updateCount: mappedTasks.length,
                    skippedCount,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

/**
 * Applies a single task's update and/or move. Returns the resulting task, or `undefined`
 * when the task carries no changes to make (skipped). Throws on any API or validation
 * error, so the caller records the whole task as a per-task failure without aborting the
 * rest of the batch.
 */
async function processTaskUpdate(task: TaskUpdate, client: TodoistApi): Promise<Task | undefined> {
    if (!hasUpdatesToMake(task)) {
        return undefined
    }

    const {
        id,
        projectId,
        sectionId,
        parentId,
        dueString,
        duration: durationStr,
        responsibleUser,
        priority,
        labels,
        deadlineDate,
        ...otherUpdateArgs
    } = task

    // Resolve "inbox" to actual inbox project ID if needed
    const resolvedProjectId = await resolveInboxProjectId({
        projectId,
        client,
    })

    let updateArgs: UpdateTaskArgs = {
        ...otherUpdateArgs,
        ...(labels !== undefined && { labels }),
    }

    // Handle priority conversion if provided
    if (priority) {
        updateArgs.priority = convertPriorityToNumber(priority)
    }

    // Handle due date changes if provided
    const dueStringUpdate = normalizeAliasValue(
        dueString,
        DUE_DATE_REMOVAL_ALIASES,
        DUE_DATE_REMOVAL_VALUE,
    )
    if (dueStringUpdate !== undefined) {
        updateArgs = { ...updateArgs, dueString: dueStringUpdate }
    }

    // Handle deadline changes if provided
    const deadlineDateUpdate = normalizeAliasValue(deadlineDate, DEADLINE_REMOVAL_ALIASES, null)
    if (deadlineDateUpdate !== undefined) {
        updateArgs = { ...updateArgs, deadlineDate: deadlineDateUpdate }
    }

    // Parse duration if provided
    if (durationStr) {
        try {
            const { minutes } = parseDuration(durationStr)
            updateArgs = {
                ...updateArgs,
                duration: minutes,
                durationUnit: 'minute',
            }
        } catch (error) {
            if (error instanceof DurationParseError) {
                throw new Error(`Task ${id}: ${error.message}`)
            }
            throw error
        }
    }

    // Handle assignment changes if provided
    if (responsibleUser !== undefined) {
        updateArgs = {
            ...updateArgs,
            assigneeId: await resolveAssigneeId(client, id, responsibleUser),
        }
    }

    // Each SDK call goes through executeWithRetry so transient 5xx responses (502/503/504)
    // are retried per item. The registerTool() wrapper's retry only fires when execute()
    // throws, which never happens now that we settle each task — and the SDK transport
    // only retries network/timeout errors, not 5xx responses.

    // If no move parameters are provided, use updateTask without moveTask
    if (!resolvedProjectId && !sectionId && !parentId) {
        return await executeWithRetry(() => client.updateTask(id, updateArgs))
    }

    const moveArgs = createMoveTaskArgs(id, resolvedProjectId, sectionId, parentId)
    const movedTask = await executeWithRetry(() => client.moveTask(id, moveArgs))

    if (Object.keys(updateArgs).length > 0) {
        return await executeWithRetry(() => client.updateTask(id, updateArgs))
    }

    return movedTask
}

/**
 * Resolves the `assigneeId` for a task update from a `responsibleUser` value: `null` to
 * unassign, or the validated collaborator's user ID. Throws if the requested assignee
 * fails validation.
 */
async function resolveAssigneeId(
    client: TodoistApi,
    id: string,
    responsibleUser: string | null,
): Promise<string | null | undefined> {
    if (responsibleUser === null || responsibleUser === 'unassign') {
        return null
    }

    const validation = await assignmentValidator.validateTaskUpdateAssignment(
        client,
        id,
        responsibleUser,
    )

    if (!validation.isValid) {
        const errorMsg = validation.error?.message || 'Assignment validation failed'
        const suggestions = validation.error?.suggestions?.join('. ') || ''
        throw new Error(`Task ${id}: ${errorMsg}${suggestions ? `. ${suggestions}` : ''}`)
    }

    return validation.resolvedUser?.userId
}

function generateTextContent({
    tasks,
    failures,
    skippedCount,
}: {
    tasks: ReturnType<typeof mapTask>[]
    failures: Array<{ item: string; error: string }>
    skippedCount: number
}) {
    const contextParts: string[] = []
    if (skippedCount > 0) {
        contextParts.push(`${skippedCount} skipped - no changes`)
    }
    if (failures.length > 0) {
        contextParts.push(`${failures.length} failed`)
    }
    const context = contextParts.length > 0 ? ` (${contextParts.join(', ')})` : ''

    const summary = summarizeTaskOperation('Updated', tasks, {
        context,
        showDetails: tasks.length <= 5,
    })

    if (failures.length === 0) {
        return summary
    }

    const shown = failures.slice(0, DisplayLimits.MAX_FAILURES_SHOWN)
    const remaining = failures.length - shown.length
    const failureLines = shown.map((f) => `    ${f.item}: ${f.error}`).join('\n')
    const moreInfo = remaining > 0 ? `\n    +${remaining} more` : ''

    return `${summary}\nFailed (${failures.length}) - address or drop these items:\n${failureLines}${moreInfo}`
}

function hasUpdatesToMake({ id: _id, ...otherUpdateArgs }: TaskUpdate) {
    return Object.keys(otherUpdateArgs).length > 0
}

function normalizeAliasValue<TReplacement extends string | null>(
    value: string | null | undefined,
    aliases: readonly string[],
    replacement: TReplacement,
) {
    if (value === undefined) {
        return value
    }

    if (value === null) {
        return replacement
    }

    const normalizedValue = value.trim().toLowerCase()
    if (aliases.includes(normalizedValue)) {
        return replacement
    }

    return value
}

export { updateTasks }
