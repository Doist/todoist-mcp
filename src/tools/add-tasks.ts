import type { AddTaskArgs, Task, TodoistApi } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { isInboxProjectId, mapTask } from '../tool-helpers.js'
import { assignmentValidator } from '../utils/assignment-validator.js'
import { DurationParseError, parseDuration } from '../utils/duration-parser.js'
import { FailureSchema, TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import {
    convertPriorityToNumber,
    PRIORITY_INPUT_DESCRIPTION,
    PrioritySchema,
} from '../utils/priorities.js'
import { summarizeBatch, summarizeTaskOperation } from '../utils/response-builders.js'
import { optionalString } from '../utils/schema-helpers.js'
import { ToolNames } from '../utils/tool-names.js'

// Maximum tasks per operation to prevent abuse and timeouts
const MAX_TASKS_PER_OPERATION = 25

const TaskSchema = z.object({
    content: z
        .string()
        .min(1)
        .describe(
            'The task name/title. Should be concise and actionable (e.g., "Review PR #123", "Call dentist"). For longer content, use the description field instead. Supports Markdown.',
        ),
    description: optionalString(
        'Additional details, notes, or context for the task. Use this for longer content rather than putting it in the task name. Supports Markdown.',
    ),
    priority: PrioritySchema.optional().describe(PRIORITY_INPUT_DESCRIPTION),
    dueString: optionalString('The due date for the task, in natural language.'),
    deadlineDate: optionalString(
        'The deadline date for the task in ISO 8601 format (YYYY-MM-DD, e.g., "2025-12-31"). Deadlines are immovable constraints shown with a different indicator than due dates.',
    ),
    duration: optionalString(
        'The duration of the task. Use format: "2h" (hours), "90m" (minutes), "2h30m" (combined), or "1.5h" (decimal hours). Max 24h.',
    ),
    labels: z.array(z.string()).optional().describe('The labels to attach to the task.'),
    projectId: optionalString(
        'The project ID to add this task to. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
    ),
    sectionId: optionalString('The section ID to add this task to.'),
    parentId: optionalString('The parent task ID (for subtasks).'),
    order: z
        .number()
        .optional()
        .describe('Position of the task among sibling tasks under the same parent/section.'),
    responsibleUser: optionalString(
        'Assign task to this user. Can be "me" (assigns to current user), a user ID, name, or email address. User must be a collaborator on the target project.',
    ),
    isUncompletable: z
        .boolean()
        .optional()
        .describe(
            'Whether this task should be uncompletable (organizational header). Tasks with isUncompletable: true appear as organizational headers and cannot be completed.',
        ),
})

const ArgsSchema = {
    tasks: z
        .array(TaskSchema)
        .min(1)
        .max(MAX_TASKS_PER_OPERATION)
        .describe(`The array of tasks to add (max ${MAX_TASKS_PER_OPERATION}).`),
}

const OutputSchema = {
    tasks: z.array(TaskOutputSchema).describe('The created tasks.'),
    totalCount: z.number().describe('The total number of tasks created.'),
    failures: z.array(FailureSchema).describe('Failed task creations with error details.'),
    totalRequested: z.number().describe('The total number of tasks requested.'),
    successCount: z.number().describe('The number of successfully created tasks.'),
    failureCount: z.number().describe('The number of failed task creations.'),
}

const addTasks = {
    name: ToolNames.ADD_TASKS,
    description:
        'Add one or more tasks (max 25 per call) using **structured fields** — content, description, priority, dueString, deadlineDate, duration, labels, projectId/sectionId/parentId, and responsibleUser. Use this for bulk creation, when you already have IDs, or when you need fields Quick Add does not support (deadlines, durations, explicit ID-based assignment). For a single user-typed natural-language task string (e.g. "Call mom tomorrow at 5pm #Personal p2"), prefer **quick-add-task**.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute(args, client) {
        // Parse through the schema to ensure transforms run (e.g., empty string stripping)
        // even when execute() is called directly without MCP server parsing
        const { tasks } = z.object(ArgsSchema).parse(args)
        // Group tasks by destination to preserve sibling order within each group,
        // while parallelizing across different destinations
        const groups = new Map<string, Array<{ task: (typeof tasks)[number]; index: number }>>()
        tasks.forEach((task, index) => {
            const key = destinationKey(task)
            const group = groups.get(key)
            if (group) {
                group.push({ task, index })
            } else {
                groups.set(key, [{ task, index }])
            }
        })

        // Process groups in parallel; within each group, process sequentially
        type IndexedResult = { index: number; result: PromiseSettledResult<Task> }
        const groupResults = await Promise.all(
            [...groups.values()].map(async (group) => {
                const results: IndexedResult[] = []
                for (const { task, index } of group) {
                    try {
                        const created = await processTask(task, client)
                        results.push({ index, result: { status: 'fulfilled', value: created } })
                    } catch (error) {
                        results.push({
                            index,
                            result: { status: 'rejected', reason: error },
                        })
                    }
                }
                return results
            }),
        )

        // Flatten and sort by original index to maintain input order in the response
        const indexed = groupResults.flat().sort((a, b) => a.index - b.index)

        const newTasks: Task[] = []
        const failures: Array<{ item: string; error: string }> = []

        for (const { index, result } of indexed) {
            if (result.status === 'fulfilled') {
                newTasks.push(result.value)
            } else {
                failures.push({
                    item: tasks[index]?.content ?? `Task ${index + 1}`,
                    error:
                        result.reason instanceof Error
                            ? result.reason.message
                            : String(result.reason),
                })
            }
        }

        // If all tasks failed, throw an error
        if (newTasks.length === 0 && failures.length > 0) {
            const details = failures.map((f) => `"${f.item}": ${f.error}`).join('; ')
            throw new Error(`All ${failures.length} task(s) failed to create: ${details}`)
        }

        const mappedTasks = newTasks.map(mapTask)

        const textContent = generateTextContent({
            tasks: mappedTasks,
            failures,
            args: { tasks },
        })

        return {
            textContent,
            structuredContent: {
                tasks: mappedTasks,
                totalCount: mappedTasks.length,
                failures,
                totalRequested: tasks.length,
                successCount: newTasks.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

/**
 * Groups tasks by their destination so sibling tasks are created sequentially
 * (preserving input order) while tasks in different destinations run in parallel.
 */
function destinationKey(task: z.infer<typeof TaskSchema>): string {
    return `${task.projectId ?? ''}|${task.sectionId ?? ''}|${task.parentId ?? ''}`
}

async function processTask(task: z.infer<typeof TaskSchema>, client: TodoistApi): Promise<Task> {
    const {
        duration: durationStr,
        projectId,
        sectionId,
        parentId,
        order,
        responsibleUser,
        priority,
        labels,
        deadlineDate,
        ...otherTaskArgs
    } = task

    // Strip "inbox" — the API defaults to inbox when no projectId is provided
    const resolvedProjectId = isInboxProjectId(projectId) ? undefined : projectId

    // Validate project is not archived
    if (resolvedProjectId) {
        const project = await client.getProject(resolvedProjectId)
        if (project.isArchived) {
            throw new Error(
                `Task "${task.content}": Cannot create task in archived project "${project.name}"`,
            )
        }
    }

    let taskArgs: AddTaskArgs = {
        ...otherTaskArgs,
        projectId: resolvedProjectId,
        sectionId,
        parentId,
        order,
        labels,
        deadlineDate,
    }

    // Handle priority conversion if provided
    if (priority) {
        taskArgs.priority = convertPriorityToNumber(priority)
    }

    // Only prevent assignment (not task creation) without sufficient project context
    if (responsibleUser && !resolvedProjectId && !sectionId && !parentId) {
        throw new Error(
            `Task "${task.content}": Cannot assign tasks without specifying project context. Please specify a projectId, sectionId, or parentId.`,
        )
    }

    // Parse duration if provided
    if (durationStr) {
        try {
            const { minutes } = parseDuration(durationStr)
            taskArgs = {
                ...taskArgs,
                duration: minutes,
                durationUnit: 'minute',
            }
        } catch (error) {
            if (error instanceof DurationParseError) {
                throw new Error(`Task "${task.content}": ${error.message}`)
            }
            throw error
        }
    }

    // Handle assignment if provided
    if (responsibleUser) {
        // Resolve target project for validation
        let targetProjectId = resolvedProjectId
        if (!targetProjectId && parentId) {
            // For subtasks, get project from parent task
            try {
                const parentTask = await client.getTask(parentId)
                targetProjectId = parentTask.projectId
            } catch (_error) {
                throw new Error(`Task "${task.content}": Parent task "${parentId}" not found`)
            }
        } else if (!targetProjectId && sectionId) {
            // For section tasks, we need to find the project - this is a limitation
            // For now, we'll require explicit projectId when using assignments with sections
            throw new Error(
                `Task "${task.content}": When assigning tasks to sections, please also specify projectId`,
            )
        }

        if (!targetProjectId) {
            throw new Error(
                `Task "${task.content}": Cannot determine target project for assignment validation`,
            )
        }

        // Validate assignment using comprehensive validator
        const validation = await assignmentValidator.validateTaskCreationAssignment(
            client,
            targetProjectId,
            responsibleUser,
        )

        if (!validation.isValid) {
            const errorMsg = validation.error?.message || 'Assignment validation failed'
            const suggestions = validation.error?.suggestions?.join('. ') || ''
            throw new Error(
                `Task "${task.content}": ${errorMsg}${suggestions ? `. ${suggestions}` : ''}`,
            )
        }

        // Use the validated assignee ID
        taskArgs.assigneeId = validation.resolvedUser?.userId
    }

    return await client.addTask(taskArgs)
}

function generateTextContent({
    tasks,
    failures,
    args,
}: {
    tasks: ReturnType<typeof mapTask>[]
    failures: Array<{ item: string; error: string }>
    args: z.infer<z.ZodObject<typeof ArgsSchema>>
}) {
    // Generate context description for mixed contexts
    const contextTypes = new Set<string>()
    for (const task of args.tasks) {
        if (task.projectId && !isInboxProjectId(task.projectId)) contextTypes.add('projects')
        else if (task.sectionId) contextTypes.add('sections')
        else if (task.parentId) contextTypes.add('subtasks')
        else contextTypes.add('inbox')
    }

    let projectContext = ''
    if (contextTypes.size === 1) {
        const contextType = Array.from(contextTypes)[0]
        projectContext = contextType === 'inbox' ? '' : `to ${contextType}`
    } else if (contextTypes.size > 1) {
        projectContext = 'to multiple contexts'
    }

    // Use batch summary when there are failures, task summary when all succeeded
    if (failures.length > 0) {
        return summarizeBatch({
            action: `Added tasks${projectContext ? ` ${projectContext}` : ''}`,
            success: tasks.length,
            total: args.tasks.length,
            successItems: tasks.map((t) => t.content ?? 'Untitled'),
            successLabel: 'Created',
            failures,
        })
    }

    return summarizeTaskOperation('Added', tasks, {
        context: projectContext,
        showDetails: true,
    })
}

export { addTasks, MAX_TASKS_PER_OPERATION }
