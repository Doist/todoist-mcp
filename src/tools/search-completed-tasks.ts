import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapTask, resolveInboxProjectId } from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { formatLabelsHint, LabelsSchema } from '../utils/labels.js'
import { TaskSchema as TaskOutputSchema } from '../utils/output-schemas.js'
import { previewTasks, summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    searchText: z
        .string()
        .min(1)
        .describe('The text to search for in completed task titles and descriptions.'),
    projectId: z
        .string()
        .optional()
        .describe(
            'Find completed tasks in this project. Project ID should be an ID string, or the text "inbox", for inbox tasks.',
        ),
    sectionId: z.string().optional().describe('Find completed tasks in this section.'),
    ...LabelsSchema,
    cursor: z
        .string()
        .optional()
        .describe('The cursor from the previous call, with the same search and filters.'),
}

const OutputSchema = {
    tasks: z.array(TaskOutputSchema).describe('The found completed tasks.'),
    nextCursor: z.string().optional(),
    totalCount: z.number().describe('The total number of tasks in this page.'),
    hasMore: z.boolean(),
    appliedFilters: z.record(z.string(), z.unknown()),
}

const searchCompletedTasks = {
    name: ToolNames.SEARCH_COMPLETED_TASKS,
    description:
        'Search completed tasks when the completion date is unknown. All search words must match the task title or description; comments are not searched. Results are ordered by completion time, newest first. Returns up to 50 tasks per page, or fewer after client-side project, section, and label filters. Tasks in archived projects are not returned. Use find-completed-tasks for completion-date windows.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { searchText, projectId, sectionId, labels, labelsOperator = 'or', cursor } = args
        const resolvedProjectId = await resolveInboxProjectId({ projectId, client })
        const { items, nextCursor } = await client.searchCompletedTasks({
            query: searchText,
            cursor,
            limit: ApiLimits.COMPLETED_TASKS_DEFAULT,
        })
        const tasks = items
            .map(mapTask)
            .filter((task) => !resolvedProjectId || task.projectId === resolvedProjectId)
            .filter((task) => !sectionId || task.sectionId === sectionId)
            .filter((task) => {
                if (!labels?.length) return true
                return labelsOperator === 'and'
                    ? labels.every((label) => task.labels.includes(label))
                    : labels.some((label) => task.labels.includes(label))
            })
        const hasClientSideFilters = Boolean(projectId || sectionId || labels?.length)
        const appliedFilters = { ...args, labelsOperator }
        const filterHints = [`text: ${searchText}`]
        if (projectId) filterHints.push(`project: ${projectId}`)
        if (sectionId) filterHints.push(`section: ${sectionId}`)
        if (labels?.length) {
            filterHints.push(`labels: ${formatLabelsHint(labels, labelsOperator)}`)
        }

        return {
            textContent: summarizeList({
                subject: 'Completed task search results',
                count: tasks.length,
                nextCursor: nextCursor ?? undefined,
                filterHints,
                previewLines: previewTasks(tasks),
                zeroReasonHints: ['Try broader search terms'],
                nextSteps: hasClientSideFilters
                    ? ['Project, section, and label filters are client-side and apply per page.']
                    : undefined,
            }),
            structuredContent: {
                tasks,
                nextCursor: nextCursor ?? undefined,
                totalCount: tasks.length,
                hasMore: Boolean(nextCursor),
                appliedFilters,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { searchCompletedTasks }
