import { GetTasksArgs } from '@doist/todoist-sdk'
import { z } from 'zod'
import {
    appendToQuery,
    buildResponsibleUserQueryFilter,
    filterTasksByResponsibleUser,
    RESPONSIBLE_USER_FILTERING,
    resolveResponsibleUser,
} from '../filter-helpers.js'
import type { TodoistTool } from '../todoist-tool.js'
import {
    getTasksByFilter,
    type MappedTask,
    mapTask,
    resolveInboxProjectId,
} from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { filterResolver } from '../utils/filter-resolver.js'
import { generateLabelsFilter, LabelsSchema } from '../utils/labels.js'
import { TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import { previewTasks, summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const { FIND_COMPLETED_TASKS, ADD_TASKS } = ToolNames

const ArgsSchema = {
    searchText: z.string().optional().describe('The text to search for in tasks.'),
    projectId: z
        .string()
        .optional()
        .describe(
            'Find tasks in this project. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
    sectionId: z.string().optional().describe('Find tasks in this section.'),
    parentId: z.string().optional().describe('Find subtasks of this parent task.'),
    responsibleUser: z
        .string()
        .optional()
        .describe('Find tasks assigned to this user. Can be a user ID, name, or email address.'),
    responsibleUserFiltering: z
        .enum(RESPONSIBLE_USER_FILTERING)
        .optional()
        .describe(
            'How to filter by responsible user when responsibleUser is not provided. "assigned" = only tasks assigned to others; "unassignedOrMe" = only unassigned tasks or tasks assigned to me; "all" = all tasks regardless of assignment. Default value will be `unassignedOrMe`.',
        ),
    limit: z
        .number()
        .int()
        .min(1)
        .max(ApiLimits.TASKS_MAX)
        .default(ApiLimits.TASKS_DEFAULT)
        .describe('The maximum number of tasks to return.'),
    cursor: z
        .string()
        .optional()
        .describe(
            'The cursor to get the next page of tasks (cursor is obtained from the previous call to this tool, with the same parameters).',
        ),
    filter: z
        .string()
        .optional()
        .describe(
            'A raw Todoist filter query string (e.g. "today", "p1", "##Work", "(today | overdue) & p1"). ' +
                'Combined with other filters using AND. Cannot be used with projectId, sectionId, parentId, or filterIdOrName.',
        ),
    filterIdOrName: z
        .string()
        .optional()
        .describe(
            "The ID or name of a saved Todoist filter. The filter's query will be fetched and used to find tasks. " +
                'Cannot be used with the `filter` parameter, projectId, sectionId, or parentId.',
        ),
    ...LabelsSchema,
}

const OutputSchema = {
    tasks: z.array(TaskOutputSchema).describe('The found tasks.'),
    nextCursor: z.string().optional(),
    totalCount: z.number().describe('The total number of tasks in this page.'),
    hasMore: z.boolean(),
    appliedFilters: z.record(z.string(), z.unknown()),
}

const findTasks = {
    name: ToolNames.FIND_TASKS,
    description:
        'Find tasks by text search, project/section/parent container, responsible user, labels, a raw Todoist filter string, or a saved filter by ID or name (filterIdOrName). At least one filter must be provided.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const {
            searchText,
            projectId,
            sectionId,
            parentId,
            responsibleUser,
            responsibleUserFiltering,
            limit,
            cursor,
            labels,
            labelsOperator,
            filter,
            filterIdOrName,
        } = args

        const todoistUser = await client.getUser()

        // Validate at least one filter is provided
        const hasLabels = labels && labels.length > 0
        if (
            !searchText &&
            !projectId &&
            !sectionId &&
            !parentId &&
            !responsibleUser &&
            !hasLabels &&
            !filter &&
            !filterIdOrName
        ) {
            throw new Error(
                'At least one filter must be provided: searchText, projectId, sectionId, parentId, responsibleUser, labels, filter, or filterIdOrName',
            )
        }

        if (filter && filterIdOrName) {
            throw new Error(
                'The `filter` and `filterIdOrName` parameters cannot be used together. Provide only one.',
            )
        }

        if ((filter || filterIdOrName) && (projectId || sectionId || parentId)) {
            throw new Error(
                'The `filter`/`filterIdOrName` parameter cannot be combined with projectId, sectionId, or parentId. Use filter syntax instead (e.g. "##ProjectName").',
            )
        }

        // Resolve filterIdOrName to a filter query string
        let resolvedFilter = filter
        if (filterIdOrName) {
            const resolved = await filterResolver.resolveFilter(client, filterIdOrName)
            resolvedFilter = resolved.filterQuery
        }

        // Resolve assignee name to user ID if provided
        const resolved = await resolveResponsibleUser(client, responsibleUser)
        const resolvedAssigneeId = resolved?.userId
        const assigneeEmail = resolved?.email

        // If using container-based filtering, use direct API
        if (projectId || sectionId || parentId) {
            const taskParams: GetTasksArgs = {
                limit,
                cursor: cursor ?? null,
            }

            if (projectId) {
                taskParams.projectId = await resolveInboxProjectId({ projectId, user: todoistUser })
            }
            if (sectionId) taskParams.sectionId = sectionId
            if (parentId) taskParams.parentId = parentId

            const { results, nextCursor } = await client.getTasks(taskParams)
            const mappedTasks = results.map(mapTask)

            // Apply search text filter
            let filteredTasks = searchText
                ? mappedTasks.filter(
                      (task) =>
                          task.content.toLowerCase().includes(searchText.toLowerCase()) ||
                          task.description?.toLowerCase().includes(searchText.toLowerCase()),
                  )
                : mappedTasks

            // Apply responsibleUid filter
            filteredTasks = filterTasksByResponsibleUser({
                tasks: filteredTasks,
                resolvedAssigneeId,
                currentUserId: todoistUser.id,
                responsibleUserFiltering,
            })

            // Apply label filter
            if (labels && labels.length > 0) {
                filteredTasks =
                    labelsOperator === 'and'
                        ? filteredTasks.filter((task) =>
                              labels.every((label) => task.labels.includes(label)),
                          )
                        : filteredTasks.filter((task) =>
                              labels.some((label) => task.labels.includes(label)),
                          )
            }

            const textContent = generateTextContent({
                tasks: filteredTasks,
                args,
                nextCursor,
                isContainerSearch: true,
                assigneeEmail,
            })

            return {
                textContent,
                structuredContent: {
                    tasks: filteredTasks,
                    nextCursor: nextCursor ?? undefined,
                    totalCount: filteredTasks.length,
                    hasMore: Boolean(nextCursor),
                    appliedFilters: args,
                },
            }
        }

        // If only responsibleUid is provided (without containers or raw filter), use assignee filter
        if (resolvedAssigneeId && !searchText && !hasLabels && !resolvedFilter) {
            const { results: tasks, nextCursor } = await client.getTasksByFilter({
                query: `assigned to: ${assigneeEmail}`,
                lang: 'en',
                limit,
                cursor: cursor ?? null,
            })

            const mappedTasks = tasks.map(mapTask)

            const textContent = generateTextContent({
                tasks: mappedTasks,
                args,
                nextCursor,
                isContainerSearch: false,
                assigneeEmail,
            })

            return {
                textContent,
                structuredContent: {
                    tasks: mappedTasks,
                    nextCursor: nextCursor ?? undefined,
                    totalCount: mappedTasks.length,
                    hasMore: Boolean(nextCursor),
                    appliedFilters: args,
                },
            }
        }

        // Handle search text and/or labels using filter query
        let query = resolvedFilter ? `(${resolvedFilter})` : ''

        // Add search text component
        if (searchText) {
            query = appendToQuery(query, `search: ${searchText}`)
        }

        // Add labels component
        const labelsFilter = generateLabelsFilter(labels, labelsOperator)
        query = appendToQuery(query, labelsFilter)

        // Add responsible user filtering to the query (server-side)
        // When using a saved filter (filterIdOrName), skip the default assignee filtering
        // unless the caller explicitly provided responsibleUser or responsibleUserFiltering,
        // since the saved filter may already include its own assignment logic.
        const skipDefaultAssigneeFilter =
            filterIdOrName && !responsibleUser && !responsibleUserFiltering
        if (!skipDefaultAssigneeFilter) {
            const responsibleUserFilter = buildResponsibleUserQueryFilter({
                resolvedAssigneeId,
                assigneeEmail,
                responsibleUserFiltering,
            })
            query = appendToQuery(query, responsibleUserFilter)
        }

        // Execute filter query
        const { tasks: filteredTasks, nextCursor } = await getTasksByFilter({
            client,
            query,
            cursor: args.cursor,
            limit: args.limit,
        })

        const textContent = generateTextContent({
            tasks: filteredTasks,
            args,
            nextCursor,
            isContainerSearch: false,
            assigneeEmail,
        })

        return {
            textContent,
            structuredContent: {
                tasks: filteredTasks,
                nextCursor: nextCursor ?? undefined,
                totalCount: filteredTasks.length,
                hasMore: Boolean(nextCursor),
                appliedFilters: args,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function getContainerZeroReasonHints(args: z.infer<z.ZodObject<typeof ArgsSchema>>): string[] {
    if (args.projectId) {
        const hints = [
            args.searchText ? 'No tasks in project match search' : 'Project has no tasks yet',
        ]
        if (!args.searchText) {
            hints.push(`Use ${ADD_TASKS} to create tasks`)
        }
        return hints
    }

    if (args.sectionId) {
        const hints = [args.searchText ? 'No tasks in section match search' : 'Section is empty']
        if (!args.searchText) {
            hints.push('Tasks may be in other sections of the project')
        }
        return hints
    }

    if (args.parentId) {
        const hints = [args.searchText ? 'No subtasks match search' : 'No subtasks created yet']
        if (!args.searchText) {
            hints.push(`Use ${ADD_TASKS} with parentId to add subtasks`)
        }
        return hints
    }

    return []
}

function generateTextContent({
    tasks,
    args,
    nextCursor,
    isContainerSearch,
    assigneeEmail,
}: {
    tasks: MappedTask[]
    args: z.infer<z.ZodObject<typeof ArgsSchema>>
    nextCursor: string | null
    isContainerSearch: boolean
    assigneeEmail?: string
}) {
    // Generate subject and filter descriptions based on search type
    let subject = 'Tasks'
    const filterHints: string[] = []
    const zeroReasonHints: string[] = []

    if (isContainerSearch) {
        // Container-based search
        if (args.projectId) {
            subject = 'Tasks in project'
            filterHints.push(`in project ${args.projectId}`)
        } else if (args.sectionId) {
            subject = 'Tasks in section'
            filterHints.push(`in section ${args.sectionId}`)
        } else if (args.parentId) {
            subject = 'Subtasks'
            filterHints.push(`subtasks of ${args.parentId}`)
        } else {
            subject = 'Tasks' // fallback, though this shouldn't happen
        }

        // Add search text filter if present
        if (args.searchText) {
            subject += ` matching "${args.searchText}"`
            filterHints.push(`containing "${args.searchText}"`)
        }

        // Add responsibleUid filter if present
        if (args.responsibleUser) {
            const email = assigneeEmail || args.responsibleUser
            subject += ` assigned to ${email}`
            filterHints.push(`assigned to ${email}`)
        }

        // Add label filter information
        if (args.labels && args.labels.length > 0) {
            const labelText = args.labels
                .map((label) => `@${label}`)
                .join(args.labelsOperator === 'and' ? ' & ' : ' | ')
            filterHints.push(`labels: ${labelText}`)
        }

        // Container-specific zero result hints
        if (tasks.length === 0) {
            zeroReasonHints.push(...getContainerZeroReasonHints(args))
        }
    } else {
        // Text, responsibleUid, or labels search
        const email = assigneeEmail || args.responsibleUser

        // Build subject based on filters
        const subjectParts = []
        if (args.filter) {
            subjectParts.push(`filter: ${args.filter}`)
        }
        if (args.searchText) {
            subjectParts.push(`"${args.searchText}"`)
        }
        if (args.responsibleUser) {
            subjectParts.push(`assigned to ${email}`)
        }
        if (args.labels && args.labels.length > 0) {
            const labelText = args.labels
                .map((label) => `@${label}`)
                .join(args.labelsOperator === 'and' ? ' & ' : ' | ')
            subjectParts.push(`with labels: ${labelText}`)
        }

        if (args.filter && !args.searchText && !args.responsibleUser && !args.labels?.length) {
            subject = `Tasks matching filter: ${args.filter}`
            filterHints.push(`filter: ${args.filter}`)
        } else if (args.searchText) {
            subject = `Search results for ${subjectParts.join(' ')}`
            filterHints.push(`matching "${args.searchText}"`)
            if (args.filter) filterHints.push(`filter: ${args.filter}`)
        } else if (args.responsibleUser && (!args.labels || args.labels.length === 0)) {
            subject = `Tasks assigned to ${email}`
            if (args.filter) filterHints.push(`filter: ${args.filter}`)
        } else if (args.labels && args.labels.length > 0 && !args.responsibleUser) {
            const labelText = args.labels
                .map((label) => `@${label}`)
                .join(args.labelsOperator === 'and' ? ' & ' : ' | ')
            subject = `Tasks with labels: ${labelText}`
            if (args.filter) filterHints.push(`filter: ${args.filter}`)
        } else {
            subject = `Tasks ${subjectParts.join(' ')}`
        }

        // Add filter hints
        if (args.responsibleUser) {
            filterHints.push(`assigned to ${email}`)
        }
        if (args.labels && args.labels.length > 0) {
            const labelText = args.labels
                .map((label) => `@${label}`)
                .join(args.labelsOperator === 'and' ? ' & ' : ' | ')
            filterHints.push(`labels: ${labelText}`)
        }

        if (tasks.length === 0) {
            if (args.responsibleUser) {
                const email = assigneeEmail || args.responsibleUser
                zeroReasonHints.push(`No tasks assigned to ${email}`)
                zeroReasonHints.push('Check if the user name is correct')
                zeroReasonHints.push(`Check completed tasks with ${FIND_COMPLETED_TASKS}`)
            }
            if (args.searchText) {
                zeroReasonHints.push('Try broader search terms')
                zeroReasonHints.push('Verify spelling and try partial words')
                if (!args.responsibleUser) {
                    zeroReasonHints.push(`Check completed tasks with ${FIND_COMPLETED_TASKS}`)
                }
            }
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

export { findTasks }
