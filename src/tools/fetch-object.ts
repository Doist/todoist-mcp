import type { PersonalProject, TodoistApi } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import {
    fetchAllActiveProjects,
    isPersonalProject,
    mapComment,
    mapProject,
    mapTask,
    type Project,
} from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import {
    CommentSchema,
    ProjectSchema,
    SectionSchema,
    TaskSchema,
    toSectionSummary,
} from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const ObjectTypes = ['task', 'project', 'comment', 'section'] as const

const ChildTaskSchema = z.object({
    id: z.string().describe('The unique ID of the subtask.'),
    content: z.string().describe('The subtask title/content.'),
    dueDate: z.string().optional().describe('The due date of the subtask (ISO 8601 format).'),
    checked: z.boolean().describe('Whether the subtask is completed.'),
    hasChildren: z
        .boolean()
        .describe(
            'Whether this subtask has subtasks of its own. Fetch it with includeChildren to expand.',
        ),
})

const ChildProjectSchema = z.object({
    id: z.string().describe('The unique ID of the sub-project.'),
    name: z.string().describe('The name of the sub-project.'),
    hasChildren: z
        .boolean()
        .describe(
            'Whether this sub-project has sub-projects of its own. Fetch it with includeChildren to expand.',
        ),
})

const ArgsSchema = {
    type: z.enum(ObjectTypes).describe('The type of object to fetch.'),
    id: z.string().min(1).describe('The unique ID of the object to fetch.'),
    includeChildren: z
        .boolean()
        .optional()
        .describe(
            'Also return the direct children of the object: subtasks for a task, sub-projects for a project. Returns childCount plus a compact list, flagging each child that has children of its own. Use this to check whether a task hides subtasks instead of a speculative find-tasks lookup. Ignored for comments and sections.',
        ),
}

const OutputSchema = {
    type: z.enum(ObjectTypes).describe('The type of object fetched.'),
    id: z.string().describe('The ID of the fetched object.'),
    object: z
        .union([TaskSchema, ProjectSchema, CommentSchema, SectionSchema])
        .describe('The fetched object data.'),
    childCount: z
        .number()
        .optional()
        .describe(
            'The number of direct children listed in children. Only present when includeChildren is set and the type supports children. 0 means the object definitively has none.',
        ),
    children: z
        .array(z.union([ChildTaskSchema, ChildProjectSchema]))
        .optional()
        .describe(
            'Direct children only: subtasks for a task, sub-projects for a project. Completed subtasks and archived sub-projects are excluded.',
        ),
    hasMoreChildren: z
        .boolean()
        .optional()
        .describe(
            `Present when the object has more than ${ApiLimits.CHILDREN_MAX} direct children and the list was truncated. Use find-tasks with parentId to page through subtasks.`,
        ),
    childrenError: z
        .string()
        .optional()
        .describe(
            'Present when the children lookup failed. childCount is then unknown - do not read its absence as "no children".',
        ),
}

type ChildSummary = z.infer<typeof ChildTaskSchema> | z.infer<typeof ChildProjectSchema>

type ChildrenResult = {
    childCount?: number
    children?: ChildSummary[]
    hasMoreChildren?: boolean
    childrenError?: string
}

/**
 * Fetches the direct subtasks of a task, flagging which of them nest further.
 *
 * The API exposes no child count on a task, so each child needs its own probe.
 * That keeps the cost proportional to the number of subtasks rather than to the
 * size of the project, which matters because the common case is a task with none.
 */
async function getTaskChildren(client: TodoistApi, taskId: string): Promise<ChildrenResult> {
    const { results, nextCursor } = await client.getTasks({
        parentId: taskId,
        limit: ApiLimits.CHILDREN_MAX,
    })

    const grandchildFlags = await Promise.all(
        results.map(async ({ id }) => {
            const { results: grandchildren } = await client.getTasks({ parentId: id, limit: 1 })
            return grandchildren.length > 0
        }),
    )

    return {
        childCount: results.length,
        children: results.map((child, index) => ({
            id: child.id,
            content: child.content,
            dueDate: child.due?.date,
            checked: child.checked,
            hasChildren: grandchildFlags[index] ?? false,
        })),
        hasMoreChildren: nextCursor ? true : undefined,
    }
}

/**
 * Fetches the direct sub-projects of a project, flagging which of them nest further.
 *
 * Projects cannot be filtered by parent server-side, so the hierarchy is derived
 * from a single fetch of every active project.
 */
async function getProjectChildren(client: TodoistApi, project: Project): Promise<ChildrenResult> {
    // Workspace projects live in folders rather than under a parent project, so
    // they never have sub-projects and need no lookup at all.
    if (!isPersonalProject(project)) {
        return { childCount: 0, children: [] }
    }

    const allProjects = await fetchAllActiveProjects(client)
    const byParent = new Map<string, PersonalProject[]>()
    for (const candidate of allProjects) {
        if (!isPersonalProject(candidate) || !candidate.parentId) continue
        const siblings = byParent.get(candidate.parentId) ?? []
        siblings.push(candidate)
        byParent.set(candidate.parentId, siblings)
    }

    const direct = [...(byParent.get(project.id) ?? [])].sort((a, b) => a.childOrder - b.childOrder)
    const listed = direct.slice(0, ApiLimits.CHILDREN_MAX)

    return {
        childCount: listed.length,
        children: listed.map((child) => ({
            id: child.id,
            name: child.name,
            hasChildren: (byParent.get(child.id)?.length ?? 0) > 0,
        })),
        hasMoreChildren: direct.length > listed.length ? true : undefined,
    }
}

/**
 * Runs a children lookup without letting its failure sink the whole fetch. The
 * error is reported rather than swallowed: a missing childCount would otherwise
 * read as "no children", which is the exact mistake the field exists to prevent.
 */
async function resolveChildren(load: () => Promise<ChildrenResult>): Promise<ChildrenResult> {
    try {
        return await load()
    } catch (error) {
        return { childrenError: error instanceof Error ? error.message : String(error) }
    }
}

function formatChildrenSummary(label: string, result: ChildrenResult): string {
    if (result.childrenError) return ` • ${label}=unavailable`
    if (result.childCount === undefined) return ''
    return ` • ${label}=${result.childCount}${result.hasMoreChildren ? '+' : ''}`
}

const fetchObject = {
    name: ToolNames.FETCH_OBJECT,
    description:
        'Fetch a single task, project, comment, or section by its ID. Use this when you have a specific object ID and want to retrieve its full details. Set includeChildren to also get its direct subtasks or sub-projects.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { type, id, includeChildren } = args

        try {
            switch (type) {
                case 'task': {
                    const task = await client.getTask(id)
                    const mappedTask = mapTask(task)
                    const children = includeChildren
                        ? await resolveChildren(() => getTaskChildren(client, id))
                        : {}
                    return {
                        textContent: `Found task: ${mappedTask.content} • id=${mappedTask.id} • priority=${mappedTask.priority} • project=${mappedTask.projectId}${formatChildrenSummary('subtasks', children)}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedTask,
                            ...children,
                        },
                    }
                }
                case 'project': {
                    const project = await client.getProject(id)
                    const mappedProject = mapProject(project)
                    const children = includeChildren
                        ? await resolveChildren(() => getProjectChildren(client, project))
                        : {}
                    return {
                        textContent: `Found project: ${mappedProject.name} • id=${mappedProject.id} • color=${mappedProject.color} • viewStyle=${mappedProject.viewStyle}${formatChildrenSummary('subProjects', children)}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedProject,
                            ...children,
                        },
                    }
                }
                case 'comment': {
                    const comment = await client.getComment(id)
                    const mappedComment = mapComment(comment)
                    const truncatedContent =
                        mappedComment.content.length > 50
                            ? `${mappedComment.content.substring(0, 50)}...`
                            : mappedComment.content
                    return {
                        textContent: `Found comment • id=${mappedComment.id} • content="${truncatedContent}" • posted=${mappedComment.postedAt}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedComment,
                        },
                    }
                }
                case 'section': {
                    const section = await client.getSection(id)

                    if (!section) {
                        throw new Error(`Section ${id} not found.`)
                    }

                    const mappedSection = toSectionSummary(section)
                    return {
                        textContent: `Found section: ${mappedSection.name} • id=${mappedSection.id}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedSection,
                        },
                    }
                }
            }
        } catch (error) {
            throw new Error(
                `Failed to fetch ${type} with id ${id}: ${error instanceof Error ? error.message : String(error)}`,
            )
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { fetchObject }
