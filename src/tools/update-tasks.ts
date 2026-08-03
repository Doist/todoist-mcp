import type {
    GetTasksArgs,
    MoveTaskArgs,
    Task,
    TodoistApi,
    UpdateTaskArgs,
} from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { isInboxProjectId, mapTask } from '../tool-helpers.js'
import { assignmentValidator } from '../utils/assignment-validator.js'
import { getMoveLimiter, getWriteLimiter } from '../utils/concurrency.js'
import { BatchLimits, DisplayLimits } from '../utils/constants.js'
import { DurationParseError, parseDuration } from '../utils/duration-parser.js'
import {
    destinationKey,
    isMoveRedundant,
    type MoveRequest,
    planMove,
} from '../utils/move-planner.js'
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
            'Move the task to this project ID, or the text "inbox" for the inbox. Omit unless the project should change: moving a task to a project also lifts it out of its section and out from under its parent.',
        ),
    sectionId: z
        .string()
        .optional()
        .describe(
            'Move the task to this section ID. Omit unless the section should change: moving a task to a section also lifts it out from under its parent.',
        ),
    parentId: z
        .string()
        .optional()
        .describe('Make the task a subtask of this task ID. Omit unless the parent should change.'),
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
        .preprocess(
            // Keep accepting legacy null while exposing a Gemini-compatible string schema.
            (value) => (value === null ? 'unassign' : value),
            z.string(),
        )
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

type TaskUpdateOutcome =
    | { kind: 'skipped' }
    | { kind: 'updated'; task: Task }
    | { kind: 'partial'; task: Task; error: string }

/** A task's outcome, including a failure that must not abort the rest of the batch. */
type BatchOutcome = TaskUpdateOutcome | { kind: 'failed'; error: string }

/** One task's requested changes, normalised into what the API needs. */
type PreparedTask = {
    /** Position in the caller's array, so results keep the order they were sent in. */
    index: number
    id: string
    updateArgs: UpdateTaskArgs
    moveRequest: MoveRequest
    redundantMoveSkipped: boolean
    /** Set once a task has an outcome that later phases must not overwrite. */
    failed: boolean
}

/** A prepared task paired with the single move it actually needs. */
type PlannedMove = { item: PreparedTask; move: MoveTaskArgs }

type MoveResult = { task: Task } | { error: string }

/**
 * A group of moves whose outcome the response did not settle, either because the
 * request failed or because the tasks were absent from it.
 */
type UnresolvedMoveGroup = {
    group: PlannedMove[]
    destination: MoveTaskArgs
    /** Absent when the request succeeded but omitted these tasks. */
    error?: unknown
}

const DUE_DATE_REMOVAL_ALIASES = ['remove', 'no date'] as const
const DEADLINE_REMOVAL_ALIASES = ['remove', 'no date', 'no deadline'] as const
const DUE_DATE_REMOVAL_VALUE = 'no date' as const

// Cap the batch size (matching add-tasks) so a single call can't fan out an unbounded
// number of concurrent SDK requests or buffer an unbounded failures response.
const MAX_TASKS_PER_OPERATION = BatchLimits.TASKS_PER_OPERATION

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
            redundantMovesSkipped: z
                .number()
                .describe(
                    'Moves not performed because the task was already in the requested destination. A non-zero count means container fields were sent that did not need to be.',
                ),
        })
        .describe('Summary of operations performed.'),
}

const updateTasks = {
    name: ToolNames.UPDATE_TASKS,
    description:
        'Update existing tasks including content, dates, priorities, and assignments. Send only the fields that change.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        // Direct callers bypass the MCP schema parser, so parse here as well to enforce
        // transforms and the batch cap before starting concurrent work.
        const { tasks } = z.object(ArgsSchema).parse(args)

        // Each task is updated independently. A failure on one task (for example, the
        // API rejecting a move with "Not allowed to move objects out of a workspace")
        // must not discard the successful updates in the same batch, nor surface as a
        // single opaque batch error that nudges the caller into retrying everything —
        // a retry loop that can trip server-side abuse penalties. So we settle every
        // task and report per-task outcomes.
        const outcomes: BatchOutcome[] = tasks.map(() => ({ kind: 'skipped' }))
        const failWith = (index: number, error: string) => {
            outcomes[index] = { kind: 'failed', error }
        }
        const fail = (index: number, error: unknown) => {
            failWith(index, formatBatchItemError(error))
        }

        const actionable = tasks
            .map((task, index) => ({ task, index }))
            .filter(({ task }) => hasUpdatesToMake(task))

        // Resolve "inbox" once for the whole batch rather than once per task.
        const inbox = await resolveBatchInboxProjectId(
            actionable.map(({ task }) => task),
            client,
        )

        const prepared = await Promise.allSettled(
            actionable.map(({ task, index }) => prepareTaskUpdate({ task, index, client, inbox })),
        )

        const ready: PreparedTask[] = []
        for (const [position, result] of prepared.entries()) {
            const index = actionable[position]?.index ?? position
            if (result.status === 'fulfilled') {
                ready.push(result.value)
            } else {
                fail(index, result.reason)
            }
        }

        // Read current containers so a caller echoing back a task's existing
        // project/section/parent doesn't turn a field edit into a move.
        const currentTasks = await fetchCurrentTaskStates({
            client,
            ids: [
                ...new Set(
                    ready.filter((item) => hasMoveRequest(item.moveRequest)).map((item) => item.id),
                ),
            ],
        })

        const moving: PlannedMove[] = []
        for (const item of ready) {
            try {
                const plan = planMove({
                    taskId: item.id,
                    request: item.moveRequest,
                    current: currentTasks.get(item.id),
                })
                item.redundantMoveSkipped = plan.redundantMoveSkipped
                if (plan.move) {
                    moving.push({ item, move: plan.move })
                }
            } catch (error) {
                fail(item.index, error)
                item.failed = true
            }
        }

        const movedTasks = await applyMoves({ client, moving })
        for (const { item } of moving) {
            const result = movedTasks.get(item.index)
            if (result && 'error' in result) {
                // Already formatted by the move phase — formatting it again would
                // flatten the API's specific objection into a bare status message.
                failWith(item.index, result.error)
                // A failed move means the field update is not attempted, so the task
                // is not left reporting a change that never applied to it.
                item.failed = true
            }
        }

        await applyFieldUpdates({
            client,
            items: ready.filter((item) => !item.failed),
            onUpdated: (item, task) => {
                outcomes[item.index] = { kind: 'updated', task }
            },
            onFailed: (item, error) => {
                const moved = movedTasks.get(item.index)
                if (moved && 'task' in moved) {
                    // The move already changed server state, so report it as partial
                    // rather than losing the fact that the task did relocate.
                    outcomes[item.index] = {
                        kind: 'partial',
                        task: moved.task,
                        error: `Move applied; field update failed: ${formatBatchItemError(error)}`,
                    }
                    return
                }
                fail(item.index, error)
            },
        })

        // Tasks that only moved have no field update to report against, so take
        // their outcome straight from the move result.
        for (const item of ready) {
            if (item.failed || hasFieldUpdates(item.updateArgs)) {
                continue
            }
            const moved = movedTasks.get(item.index)
            if (moved && 'task' in moved) {
                outcomes[item.index] = { kind: 'updated', task: moved.task }
            }
        }

        const { updatedTasks, failures, skippedCount } = collectOutcomes({ tasks, outcomes })
        const redundantMovesSkipped = ready.filter((item) => item.redundantMoveSkipped).length

        // Never throw for per-item problems — even when every task fails. Returning the
        // structured result (empty `tasks`, populated `failures`) keeps total and partial
        // failures uniform and preserves the per-item reason for each task, rather than
        // collapsing them into one opaque error.
        const mappedTasks = updatedTasks.map(mapTask)

        const textContent = generateTextContent({
            tasks: mappedTasks,
            failures,
            skippedCount,
            redundantMovesSkipped,
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
                    redundantMovesSkipped,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

/**
 * Folds per-task outcomes into the response's parallel lists, keeping the order the
 * caller sent them in.
 */
function collectOutcomes({ tasks, outcomes }: { tasks: TaskUpdate[]; outcomes: BatchOutcome[] }): {
    updatedTasks: Task[]
    failures: Array<{ item: string; error: string; code?: string }>
    skippedCount: number
} {
    const updatedTasks: Task[] = []
    const failures: Array<{ item: string; error: string; code?: string }> = []
    let skippedCount = 0

    for (const [index, outcome] of outcomes.entries()) {
        const item = tasks[index]?.id ?? `Task ${index + 1}`
        if (outcome.kind === 'skipped') {
            skippedCount++
            continue
        }
        if (outcome.kind === 'failed') {
            failures.push({ item, error: outcome.error })
            continue
        }

        updatedTasks.push(outcome.task)
        if (outcome.kind === 'partial') {
            failures.push({ item, error: outcome.error, code: 'PARTIAL_MOVE_APPLIED' })
        }
    }

    return { updatedTasks, failures, skippedCount }
}

/**
 * Fetches the current user once when any task in the batch targets the inbox, so a
 * 25-task batch costs one lookup rather than 25. A failure is carried rather than
 * thrown so it only fails the tasks that actually needed the resolution.
 */
async function resolveBatchInboxProjectId(
    tasks: TaskUpdate[],
    client: TodoistApi,
): Promise<{ projectId?: string; error?: unknown }> {
    if (!tasks.some((task) => isInboxProjectId(task.projectId))) {
        return {}
    }

    try {
        const user = await executeWithRetry(() => client.getUser())
        return { projectId: user.inboxProjectId }
    } catch (error) {
        return { error }
    }
}

/**
 * Builds the query for reading a specific set of tasks.
 *
 * The endpoint expects `ids` as a comma-separated list, while the SDK serialises
 * array parameters as JSON — which the API rejects outright with
 * `INVALID_ARGUMENT_VALUE`. Passing the joined form is what actually works, so the
 * cast buys a query the API accepts rather than papering over a type mismatch.
 */
function buildTaskIdsQuery(ids: string[]): GetTasksArgs {
    return {
        ids: ids.join(','),
        limit: Math.max(ids.length, MAX_TASKS_PER_OPERATION),
    } as unknown as GetTasksArgs
}

/**
 * Reads the current containers of every task that might be moved, in one request.
 *
 * Deliberately a single page rather than a paginated sweep: if the API ever ignored
 * the `ids` filter, following cursors would walk the caller's entire account. One
 * page covers the batch cap, and the results are filtered locally so an unfiltered
 * response can't be mistaken for task state.
 *
 * Any task missing from the response — and a failure of the read itself — leaves the
 * state unknown, which means the requested move goes ahead. The server remains the
 * authority; the worst case is the redundant write we would have made anyway. A
 * malformed id fails the whole read rather than being omitted from it, which costs
 * this batch its no-op detection but nothing more.
 */
async function fetchCurrentTaskStates({
    client,
    ids,
}: {
    client: TodoistApi
    ids: string[]
}): Promise<Map<string, Task>> {
    const states = new Map<string, Task>()
    if (ids.length === 0) {
        return states
    }

    try {
        const requested = new Set(ids)
        const { results } = await executeWithRetry(() => client.getTasks(buildTaskIdsQuery(ids)))
        for (const task of results) {
            if (requested.has(task.id)) {
                states.set(task.id, task)
            }
        }
    } catch {
        // Unknown state, so every requested move goes ahead.
    }

    return states
}

/**
 * Sends the planned moves, collapsing tasks bound for the same destination into a
 * single request.
 *
 * Groups run one at a time: the API locks a task's whole tree for a move, and a tree
 * spans the source as well as the destination, so overlapping moves contend even when
 * they target different places.
 */
async function applyMoves({
    client,
    moving,
}: {
    client: TodoistApi
    moving: PlannedMove[]
}): Promise<Map<number, MoveResult>> {
    // Keyed by the caller's position, not by task id: the same id may legitimately
    // appear twice in one batch, and keying by id would let the second entry's
    // outcome overwrite the first's.
    const results = new Map<number, MoveResult>()
    if (moving.length === 0) {
        return results
    }

    const groups = new Map<string, PlannedMove[]>()
    for (const planned of moving) {
        const key = destinationKey(planned.move)
        const group = groups.get(key)
        if (group) {
            group.push(planned)
        } else {
            groups.set(key, [planned])
        }
    }

    const moveLimiter = getMoveLimiter(client)
    const unresolved: UnresolvedMoveGroup[] = []

    for (const group of groups.values()) {
        const ids = group.map(({ item }) => item.id)
        // `move` is identical across a group by construction.
        const destination = group[0]?.move as MoveTaskArgs
        const sole = group.length === 1 ? group[0] : undefined

        try {
            if (sole) {
                // A lone move keeps the single-task endpoint: its response is that task
                // and its errors already name it, so there is nothing to disambiguate.
                const moved = await moveLimiter(() =>
                    executeWithRetry(() => client.moveTask(sole.item.id, destination)),
                )
                results.set(sole.item.index, { task: moved })
                continue
            }

            const moved = await moveLimiter(() =>
                executeWithRetry(() => client.moveTasks(ids, destination)),
            )

            const byId = new Map(moved.map((task) => [task.id, task]))
            const unaccounted: PlannedMove[] = []
            for (const planned of group) {
                const task = byId.get(planned.item.id)
                if (task) {
                    results.set(planned.item.index, { task })
                } else {
                    unaccounted.push(planned)
                }
            }

            // A response that omits a task says nothing about whether its move ran, so
            // check rather than assume.
            if (unaccounted.length > 0) {
                unresolved.push({ group: unaccounted, destination })
            }
        } catch (error) {
            if (sole) {
                results.set(sole.item.index, { error: formatBatchItemError(error) })
                continue
            }

            // A batched move is one request carrying many commands, and the API applies
            // them independently while reporting only the first problem. Treating the
            // whole group as failed would misreport tasks that did move, so read the
            // group back and let the server say which commands landed.
            unresolved.push({ group, destination, error })
        }
    }

    // Reconcile every unresolved group from one read. Reading per group would turn a
    // batch that fails as pairs into a dozen sequential reads on the error path.
    if (unresolved.length > 0) {
        await reconcileMoves({ client, unresolved, results })
    }

    return results
}

/**
 * Determines from current state which unresolved moves actually reached their
 * destination. Those that did not are reported as failures, carrying the batch error
 * where there is one.
 */
async function reconcileMoves({
    client,
    unresolved,
    results,
}: {
    client: TodoistApi
    unresolved: UnresolvedMoveGroup[]
    results: Map<number, MoveResult>
}): Promise<void> {
    const ids = [...new Set(unresolved.flatMap(({ group }) => group.map(({ item }) => item.id)))]
    const states = await fetchCurrentTaskStates({ client, ids })

    for (const { group, destination, error } of unresolved) {
        const reason =
            error === undefined ? 'Task not returned by the move' : formatBatchItemError(error)

        for (const { item } of group) {
            const current = states.get(item.id)
            if (current && isMoveRedundant(current, destination)) {
                results.set(item.index, { task: current })
                continue
            }
            // Unreadable state counts as failed: over-reporting a failure is safer than
            // claiming a move that never happened, and a corrective retry is now cheap
            // because an already-moved task is recognised as needing no move.
            results.set(item.index, { error: reason })
        }
    }
}

/**
 * Applies field updates for every prepared task that has them, bounded so a large
 * batch doesn't fan out unbounded writes.
 */
async function applyFieldUpdates({
    client,
    items,
    onUpdated,
    onFailed,
}: {
    client: TodoistApi
    items: PreparedTask[]
    onUpdated: (item: PreparedTask, task: Task) => void
    onFailed: (item: PreparedTask, error: unknown) => void
}): Promise<void> {
    const writeLimiter = getWriteLimiter(client)

    await Promise.all(
        items
            .filter((item) => hasFieldUpdates(item.updateArgs))
            .map(async (item) => {
                try {
                    const task = await writeLimiter(() =>
                        executeWithRetry(() => client.updateTask(item.id, item.updateArgs)),
                    )
                    onUpdated(item, task)
                } catch (error) {
                    onFailed(item, error)
                }
            }),
    )
}

function hasMoveRequest(request: MoveRequest): boolean {
    return Boolean(request.projectId || request.sectionId || request.parentId)
}

function hasFieldUpdates(updateArgs: UpdateTaskArgs): boolean {
    return Object.keys(updateArgs).length > 0
}

/**
 * Turns one task's requested changes into the arguments the API needs: normalised
 * field updates plus the containers it was asked to move to. Validation and parsing
 * problems throw so the caller records that task as a failure without aborting the
 * rest of the batch.
 */
async function prepareTaskUpdate({
    task,
    index,
    client,
    inbox,
}: {
    task: TaskUpdate
    index: number
    client: TodoistApi
    inbox: { projectId?: string; error?: unknown }
}): Promise<PreparedTask> {
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

    if (isInboxProjectId(projectId) && inbox.error !== undefined) {
        throw inbox.error
    }
    const resolvedProjectId = isInboxProjectId(projectId) ? inbox.projectId : projectId

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

    return {
        index,
        id,
        updateArgs,
        moveRequest: {
            projectId: resolvedProjectId,
            sectionId,
            parentId,
        },
        redundantMoveSkipped: false,
        failed: false,
    }
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
    redundantMovesSkipped,
}: {
    tasks: ReturnType<typeof mapTask>[]
    failures: Array<{ item: string; error: string; code?: string }>
    skippedCount: number
    redundantMovesSkipped: number
}) {
    const contextParts: string[] = []
    if (skippedCount > 0) {
        contextParts.push(`${skippedCount} skipped - no changes`)
    }
    if (redundantMovesSkipped > 0) {
        contextParts.push(`${redundantMovesSkipped} already in requested destination`)
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
