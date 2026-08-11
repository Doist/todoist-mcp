import { z } from 'zod'
import { appendToQuery, resolveResponsibleUser } from '../filter-helpers.js'
import type { TodoistTool } from '../todoist-tool.js'
import { mapTask, resolveInboxProjectId } from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { getDateInOffset, parseGmtOffsetToMinutes, shiftDateStringByDays } from '../utils/date.js'
import { generateLabelsFilter, LabelsSchema } from '../utils/labels.js'
import { TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import { previewTasks, summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

// No ToolNames constants needed - we only use cursor-based pagination
const DEFAULT_DATE_WINDOW_DAYS = 7

/**
 * Resolve the effective local-date window for completed-task queries.
 *
 * Why this exists:
 * - The API call still needs concrete `since`/`until` values when the user omits them.
 * - "Last 7 days" must be based on the user's local day boundaries, not server UTC day boundaries.
 * - We use the user's GMT offset so defaults remain deterministic and aligned with how users
 *   think about dates in Todoist.
 */
function resolveEffectiveDateRange({
    since,
    until,
    userGmtOffset,
    now = new Date(),
}: {
    since?: string
    until?: string
    userGmtOffset: string
    now?: Date
}): { since: string; until: string } {
    const offsetMinutes = parseGmtOffsetToMinutes(userGmtOffset)
    const today = getDateInOffset(now, offsetMinutes)
    const daysOffset = DEFAULT_DATE_WINDOW_DAYS - 1

    const effectiveUntil = until ?? (since ? shiftDateStringByDays(since, daysOffset) : today)
    const effectiveSince = since ?? shiftDateStringByDays(effectiveUntil, -daysOffset)

    return {
        since: effectiveSince,
        until: effectiveUntil,
    }
}

const ArgsSchema = {
    getBy: z
        .enum(['completion', 'due'])
        .default('completion')
        .describe(
            'The method to use to get the tasks: "completion" to get tasks by completion date (ie, when the task was actually completed), "due" to get tasks by due date (ie, when the task was due to be completed by).',
        ),
    since: z
        .string()
        .date()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe(
            'Optional start date for completed tasks. Format: YYYY-MM-DD. Defaults to 6 days before until (or today if until is omitted), resulting in a 7-day window.',
        ),
    until: z
        .string()
        .date()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe(
            'Optional end date for completed tasks. Format: YYYY-MM-DD. Defaults to 6 days after since (or today if since is omitted), resulting in a 7-day window.',
        ),
    workspaceId: z.string().optional().describe('The ID of the workspace to get the tasks for.'),
    projectId: z
        .string()
        .optional()
        .describe(
            'The ID of the project to get the tasks for. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
    sectionId: z.string().optional().describe('The ID of the section to get the tasks for.'),
    parentId: z.string().optional().describe('The ID of the parent task to get the tasks for.'),
    responsibleUser: z
        .string()
        .optional()
        .describe(
            'Filter completed tasks assigned to this user. User ID, name, or email. For personal queries (summaries, plans, reports), set to current user from user-info to exclude collaborators. Defaults to all collaborators.',
        ),

    limit: z
        .number()
        .int()
        .min(1)
        .max(ApiLimits.COMPLETED_TASKS_MAX)
        .default(ApiLimits.COMPLETED_TASKS_DEFAULT)
        .describe('The maximum number of tasks to return.'),
    cursor: z
        .string()
        .optional()
        .describe(
            'The cursor to get the next page of tasks (cursor is obtained from the previous call to this tool, with the same parameters).',
        ),
    ...LabelsSchema,
}

const OutputSchema = {
    tasks: z.array(TaskOutputSchema).describe('The found completed tasks.'),
    nextCursor: z.string().optional(),
    totalCount: z.number().describe('The total number of tasks in this page.'),
    hasMore: z.boolean(),
    appliedFilters: z.record(z.string(), z.unknown()),
}

const findCompletedTasks = {
    name: ToolNames.FIND_COMPLETED_TASKS,
    description:
        'Get completed tasks in a date range. For "what did I complete/get done" questions, use find-activity instead — it reports completion events, including every occurrence of a recurring task, which this tool does not. since/until are optional and default to a 7-day window when omitted. Includes all collaborators by default. Person-specific queries (summaries, plans, reports) require responsibleUser.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { getBy, labels, labelsOperator, since, until, responsibleUser, projectId, ...rest } =
            args

        // Cursor pagination must keep the exact same date window as page 1.
        // If since/until are omitted, they are recomputed from "today" and can drift
        // after midnight between requests, causing inconsistent pagination.
        if (args.cursor && (!since || !until)) {
            throw new Error(
                'Cursor pagination requires explicit since and until. Reuse structuredContent.appliedFilters.since and structuredContent.appliedFilters.until from the previous page.',
            )
        }

        // Resolve assignee name to user ID if provided
        const resolved = await resolveResponsibleUser(client, responsibleUser)
        const assigneeEmail = resolved?.email

        // Build combined filter query (labels + assignment)
        const labelsFilter = generateLabelsFilter(labels, labelsOperator)
        let filterQuery = labelsFilter

        if (resolved && assigneeEmail) {
            filterQuery = appendToQuery(filterQuery, `assigned to: ${assigneeEmail}`)
        }

        // Get user timezone to convert local dates to UTC
        const user = await client.getUser()
        const userGmtOffset = user.tzInfo?.gmtString || '+00:00'

        // Resolve "inbox" to actual inbox project ID if needed
        const resolvedProjectId = await resolveInboxProjectId({
            projectId,
            user,
        })

        // Convert user's local date to UTC timestamps
        // This ensures we capture the entire day from the user's perspective
        const effectiveDateRange = resolveEffectiveDateRange({
            since,
            until,
            userGmtOffset,
        })

        const sinceWithOffset = `${effectiveDateRange.since}T00:00:00${userGmtOffset}`
        const untilWithOffset = `${effectiveDateRange.until}T23:59:59${userGmtOffset}`

        // Parse and convert to UTC
        const sinceDateTime = new Date(sinceWithOffset).toISOString()
        const untilDateTime = new Date(untilWithOffset).toISOString()
        const effectiveArgs = {
            ...args,
            since: effectiveDateRange.since,
            until: effectiveDateRange.until,
        }

        const { items, nextCursor } =
            getBy === 'completion'
                ? await client.getCompletedTasksByCompletionDate({
                      ...rest,
                      projectId: resolvedProjectId,
                      since: sinceDateTime,
                      until: untilDateTime,
                      ...(filterQuery ? { filterQuery, filterLang: 'en' } : {}),
                  })
                : await client.getCompletedTasksByDueDate({
                      ...rest,
                      projectId: resolvedProjectId,
                      since: sinceDateTime,
                      until: untilDateTime,
                      ...(filterQuery ? { filterQuery, filterLang: 'en' } : {}),
                  })
        const mappedTasks = items.map(mapTask)

        const textContent = generateTextContent({
            tasks: mappedTasks,
            args: effectiveArgs,
            nextCursor,
            assigneeEmail,
        })

        return {
            textContent,
            structuredContent: {
                tasks: mappedTasks,
                nextCursor: nextCursor ?? undefined,
                totalCount: mappedTasks.length,
                hasMore: Boolean(nextCursor),
                appliedFilters: effectiveArgs,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

type FindCompletedTasksArgs = z.infer<z.ZodObject<typeof ArgsSchema>>
type ResolvedFindCompletedTasksArgs = FindCompletedTasksArgs & { since: string; until: string }

function generateTextContent({
    tasks,
    args,
    nextCursor,
    assigneeEmail,
}: {
    tasks: ReturnType<typeof mapTask>[]
    args: ResolvedFindCompletedTasksArgs
    nextCursor: string | null
    assigneeEmail?: string
}) {
    // Generate subject description
    const getByText = args.getBy === 'completion' ? 'completed' : 'due'
    const subject = `Completed tasks (by ${getByText} date)`

    // Generate filter hints
    const filterHints: string[] = []
    filterHints.push(`${getByText} date: ${args.since} to ${args.until}`)
    if (args.projectId) filterHints.push(`project: ${args.projectId}`)
    if (args.sectionId) filterHints.push(`section: ${args.sectionId}`)
    if (args.parentId) filterHints.push(`parent: ${args.parentId}`)
    if (args.workspaceId) filterHints.push(`workspace: ${args.workspaceId}`)

    // Add label filter information
    if (args.labels && args.labels.length > 0) {
        const labelText = args.labels
            .map((label) => `@${label}`)
            .join(args.labelsOperator === 'and' ? ' & ' : ' | ')
        filterHints.push(`labels: ${labelText}`)
    }

    // Add responsible user filter information
    if (args.responsibleUser) {
        const email = assigneeEmail || args.responsibleUser
        filterHints.push(`assigned to: ${email}`)
    }

    // Generate helpful suggestions for empty results
    const zeroReasonHints: string[] = []
    if (tasks.length === 0) {
        zeroReasonHints.push('No tasks completed in this date range')
        zeroReasonHints.push('Try expanding the date range')
        if (args.projectId || args.sectionId || args.parentId) {
            zeroReasonHints.push('Try removing project/section/parent filters')
        }
        if (args.getBy === 'due') {
            zeroReasonHints.push('Try switching to "completion" date instead')
        }
    }

    return summarizeList({
        subject,
        count: tasks.length,
        limit: args.limit,
        nextCursor: nextCursor ?? undefined,
        filterHints,
        previewLines: previewTasks(tasks, Math.min(tasks.length, args.limit)),
        zeroReasonHints,
    })
}

export { findCompletedTasks }
