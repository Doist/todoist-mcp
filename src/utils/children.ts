import type { PersonalProject, TodoistApi } from '@doist/todoist-sdk'
import { z } from 'zod'
import { fetchAllActiveProjects, isPersonalProject, type Project } from '../tool-helpers.js'
import { ApiLimits } from './constants.js'
import { ProjectSchema, TaskSchema } from './output-schemas.js'

const ChildTaskSchema = TaskSchema.pick({
    id: true,
    content: true,
    dueDate: true,
    checked: true,
}).extend({
    hasChildren: z
        .boolean()
        .describe(
            'Whether this subtask has subtasks of its own. Fetch it with includeChildren to expand.',
        ),
})

const ChildProjectSchema = ProjectSchema.pick({ id: true, name: true }).extend({
    hasChildren: z
        .boolean()
        .describe(
            'Whether this sub-project has sub-projects of its own. Fetch it with includeChildren to expand.',
        ),
})

/**
 * Output schema fragment for tools that can return an object's direct children.
 * Spread it into the tool's own output schema.
 */
const ChildrenOutputSchema = {
    childCount: z
        .number()
        .optional()
        .describe(
            'The number of direct children listed in children. Only present when children were requested and the type supports them. 0 means the object definitively has none.',
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
            `Present when the object has more than ${ApiLimits.CHILDREN_MAX} direct children and the list was truncated. Page through the rest with find-tasks by parentId for subtasks, or find-projects for sub-projects.`,
        ),
    childrenError: z
        .string()
        .optional()
        .describe(
            'Present when the children lookup failed or returned incomplete information. When no children are listed alongside it, childCount is unknown - do not read its absence as "no children".',
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

    // Settled rather than all: a probe that fails should cost its own nesting
    // flag, not the whole subtask listing that was already fetched.
    const probes = await Promise.allSettled(
        results.map(({ id }) => client.getTasks({ parentId: id, limit: 1 })),
    )
    const unprobed = probes.filter((probe) => probe.status === 'rejected').length

    return {
        childCount: results.length,
        children: results.map((child, index) => {
            const probe = probes[index]
            return {
                id: child.id,
                content: child.content,
                dueDate: child.due?.date,
                checked: child.checked,
                hasChildren: probe?.status === 'fulfilled' && probe.value.results.length > 0,
            }
        }),
        hasMoreChildren: nextCursor ? true : undefined,
        childrenError: unprobed
            ? `Could not check ${unprobed} of ${results.length} subtasks for subtasks of their own; those are reported as hasChildren=false.`
            : undefined,
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
 * Runs a children lookup without letting its failure sink the fetch it belongs to.
 * The error is reported rather than swallowed: a missing childCount would otherwise
 * read as "no children", which is the exact mistake these fields exist to prevent.
 */
async function resolveChildren(load: () => Promise<ChildrenResult>): Promise<ChildrenResult> {
    try {
        return await load()
    } catch (error) {
        return { childrenError: error instanceof Error ? error.message : String(error) }
    }
}

/** Renders a children result as a suffix for a tool's one-line text summary. */
function formatChildrenSummary(label: string, result: ChildrenResult): string {
    if (result.childCount === undefined) {
        return result.childrenError ? ` • ${label}=unavailable` : ''
    }
    const truncated = result.hasMoreChildren ? '+' : ''
    const partial = result.childrenError ? ' (partial)' : ''
    return ` • ${label}=${result.childCount}${truncated}${partial}`
}

export {
    ChildrenOutputSchema,
    formatChildrenSummary,
    getProjectChildren,
    getTaskChildren,
    resolveChildren,
}
export type { ChildrenResult }
