import type {
    PersonalProject,
    Section,
    SyncCommand,
    TodoistApi,
    WorkspaceProject,
} from '@doist/todoist-sdk'
import { createCommand } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { isWorkspaceProject } from '../tool-helpers.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { computeOrderKeys, type OrderedSibling, type Placement } from '../utils/order-keys.js'
import { FailureSchema } from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { settleSyncCommands } from '../utils/sync-commands.js'
import { ToolNames } from '../utils/tool-names.js'

const reorderableTypes = ['project', 'section'] as const

const ReorderItemSchema = z.object({
    id: z.string().min(1).describe('The ID of the entity.'),
    order: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
            '0-based position among its siblings after the reorder: 0 is first, past the end is last. Unlisted siblings keep their relative order.',
        ),
    parentId: z
        .string()
        .min(1)
        .optional()
        .describe(
            'Move a personal project under this parent project ID, or "root" for the top level. Personal projects only.',
        ),
})

const ArgsSchema = {
    type: z
        .enum(reorderableTypes)
        .describe(
            '"project": personal projects among the siblings under their parent, or workspace projects within their folder. "section": sections within their project.',
        ),
    items: z
        .array(ReorderItemSchema)
        .min(1)
        .describe(
            'Each item needs order and/or parentId. Moves happen first, so order is a position under the new parent.',
        ),
}

const OutputSchema = {
    type: z.enum(reorderableTypes).describe('The type of entity that was reordered/moved.'),
    movedCount: z.number().describe('The number of entities moved to a new parent.'),
    reorderedCount: z.number().describe('The number of entities reordered.'),
    affectedIds: z.array(z.string()).describe('The IDs of the entities moved or reordered.'),
    failures: z
        .array(FailureSchema)
        .describe('Entities that could not be moved or reordered, with the reason for each.'),
    success: z.boolean().describe('Whether every entity was moved and reordered as asked.'),
}

type Item = z.infer<typeof ReorderItemSchema>
type Failure = { item: string; error: string }
type Project = PersonalProject | WorkspaceProject

/** One key change to send, and the ID of the entity it re-keys. */
type KeyUpdate = { id: string; command: SyncCommand }

const reorderObjects = {
    name: ToolNames.REORDER_OBJECTS,
    description:
        'Reorder projects or sections, and optionally move personal projects to a new parent. ' +
        'Personal projects: order places a project among its siblings; parentId moves it ("root" for top level). ' +
        'Workspace projects: order places a project within its folder, in the shared default ordering every member sees; needs permission to reorder the workspace. ' +
        'Sections: order places a section within its project.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { type, items } = args

        const seenIds = new Set<string>()
        for (const item of items) {
            if (seenIds.has(item.id)) {
                throw new Error(`Duplicate item id=${item.id}. Each item must appear only once.`)
            }
            seenIds.add(item.id)
            if (item.order === undefined && item.parentId === undefined) {
                throw new Error(
                    `Item id=${item.id} must have at least one of "order" or "parentId".`,
                )
            }
            if (item.parentId !== undefined && type !== 'project') {
                throw new Error(
                    `parentId is only supported when type is "project", but type is "${type}".`,
                )
            }
        }

        const result =
            type === 'project'
                ? await reorderProjects(client, items)
                : await reorderSections(client, items)

        logBatchFailures(ToolNames.REORDER_OBJECTS, items.length, result.failures)

        const entityLabel = type === 'project' ? 'projects' : 'sections'
        const affectedIds = items
            .map((item) => item.id)
            .filter((id) => result.movedIds.has(id) || result.reorderedIds.has(id))
        const parts: string[] = []
        if (result.movedIds.size > 0) {
            parts.push(`moved ${result.movedIds.size}`)
        }
        if (result.reorderedIds.size > 0 || parts.length === 0) {
            parts.push(`reordered ${result.reorderedIds.size}`)
        }
        const summary =
            affectedIds.length > 0
                ? `${parts.join(' and ')} ${entityLabel}: ${affectedIds.map((id) => `id=${id}`).join(', ')}`
                : `${parts.join(' and ')} ${entityLabel}`

        return {
            textContent: appendFailureSummary(summary, result.failures),
            structuredContent: {
                type,
                movedCount: result.movedIds.size,
                reorderedCount: result.reorderedIds.size,
                affectedIds,
                failures: result.failures,
                success: result.failures.length === 0,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

type ReorderResult = {
    movedIds: Set<string>
    reorderedIds: Set<string>
    failures: Failure[]
}

async function reorderProjects(client: TodoistApi, items: Item[]): Promise<ReorderResult> {
    const movedIds = new Set<string>()
    const reorderedIds = new Set<string>()
    const failures: Failure[] = []

    // Nothing has been written yet, so a failed read can still fail the whole call.
    let projects = await readProjects(client)

    const usable: Item[] = []
    for (const item of items) {
        const project = projects.get(item.id)
        const problem = project
            ? projectProblem(project, item)
            : 'Project not found, or you do not have access to it.'
        if (problem) {
            failures.push({ item: item.id, error: problem })
        } else {
            usable.push(item)
        }
    }

    const moves = usable.filter((item) => item.parentId !== undefined)
    const failedMoves = new Set<string>()
    if (moves.length > 0) {
        const { outcomes } = await settleSyncCommands(
            client,
            moves.map((item) =>
                createCommand('project_move', {
                    id: item.id,
                    parentId: item.parentId === 'root' ? null : item.parentId,
                }),
            ),
        )
        outcomes.forEach((outcome, index) => {
            const id = moves[index]?.id
            if (id === undefined) return
            if (outcome.status === 'fulfilled') {
                movedIds.add(id)
            } else {
                failedMoves.add(id)
                failures.push({ item: id, error: formatBatchItemError(outcome.reason) })
            }
        })
    }

    const toReorder = usable.filter(
        (item): item is Item & { order: number } =>
            item.order !== undefined && !failedMoves.has(item.id),
    )
    if (toReorder.length === 0) {
        return { movedIds, reorderedIds, failures }
    }

    if (movedIds.size > 0) {
        // A move gives the project a key under its new parent; read it back so the
        // reorder places it among its new siblings rather than its old ones.
        try {
            projects = await readProjects(client)
        } catch (error) {
            const reason = `Moved, but the new siblings could not be read to reorder it: ${formatBatchItemError(error)}`
            for (const item of toReorder) {
                failures.push({ item: item.id, error: reason })
            }
            return { movedIds, reorderedIds, failures }
        }
    }

    const scopes = new Map<string, { siblings: Project[]; placements: Placement[] }>()
    for (const item of toReorder) {
        const project = projects.get(item.id)
        if (!project) {
            failures.push({ item: item.id, error: 'Project not found after moving it.' })
            continue
        }
        const scope = projectScope(project)
        let entry = scopes.get(scope)
        if (!entry) {
            entry = {
                siblings: [...projects.values()].filter(
                    (sibling) => isOrderable(sibling) && projectScope(sibling) === scope,
                ),
                placements: [],
            }
            scopes.set(scope, entry)
        }
        entry.placements.push({ id: item.id, position: item.order })
    }

    const updates: KeyUpdate[] = []
    for (const { siblings, placements } of scopes.values()) {
        const newKeys = computeOrderKeys(siblings.map(toOrderedProject), placements)
        for (const [id, key] of newKeys) {
            const project = projects.get(id)
            updates.push({
                id,
                command: createCommand(
                    'project_update',
                    project && isWorkspaceProject(project)
                        ? { id, defaultOrderKey: key }
                        : { id, orderKey: key },
                ),
            })
        }
    }

    await applyKeyUpdates(client, updates, toReorder, reorderedIds, failures)
    return { movedIds, reorderedIds, failures }
}

async function reorderSections(client: TodoistApi, items: Item[]): Promise<ReorderResult> {
    const reorderedIds = new Set<string>()
    const failures: Failure[] = []

    const sections = await readSections(client)

    const scopes = new Map<string, Placement[]>()
    const toReorder: Array<Item & { order: number }> = []
    for (const item of items) {
        const section = sections.get(item.id)
        if (!section || section.isDeleted) {
            failures.push({
                item: item.id,
                error: 'Section not found, or you do not have access to it.',
            })
            continue
        }
        if (section.isArchived) {
            failures.push({ item: item.id, error: 'Archived sections cannot be reordered.' })
            continue
        }
        if (item.order === undefined) continue
        toReorder.push({ ...item, order: item.order })
        const placements = scopes.get(section.projectId) ?? []
        placements.push({ id: item.id, position: item.order })
        scopes.set(section.projectId, placements)
    }

    const updates: KeyUpdate[] = []
    for (const [projectId, placements] of scopes) {
        const siblings = [...sections.values()].filter(
            (section) =>
                section.projectId === projectId && !section.isDeleted && !section.isArchived,
        )
        const newKeys = computeOrderKeys(
            siblings.map((section) => ({
                id: section.id,
                key: section.orderKey ?? null,
                legacyOrder: section.sectionOrder,
            })),
            placements,
        )
        for (const [id, key] of newKeys) {
            updates.push({ id, command: createCommand('section_update', { id, orderKey: key }) })
        }
    }

    await applyKeyUpdates(client, updates, toReorder, reorderedIds, failures)
    return { movedIds: new Set(), reorderedIds, failures }
}

/**
 * Sends the key changes and records which requested items ended up in place.
 *
 * A requested item counts as reordered when its own key change was applied, or
 * when it needed none. A key change for a sibling that was not requested only
 * happens when a whole list is re-keyed; if one fails, it is reported under that
 * sibling's ID so the caller knows the list may not read as asked.
 */
async function applyKeyUpdates(
    client: TodoistApi,
    updates: KeyUpdate[],
    requested: ReadonlyArray<{ id: string }>,
    reorderedIds: Set<string>,
    failures: Failure[],
): Promise<void> {
    const failedIds = new Set<string>()
    if (updates.length > 0) {
        const { outcomes } = await settleSyncCommands(
            client,
            updates.map((update) => update.command),
        )
        outcomes.forEach((outcome, index) => {
            const id = updates[index]?.id
            if (id === undefined || outcome.status === 'fulfilled') return
            failedIds.add(id)
            failures.push({ item: id, error: formatBatchItemError(outcome.reason) })
        })
    }
    for (const { id } of requested) {
        if (!failedIds.has(id)) {
            reorderedIds.add(id)
        }
    }
}

function projectProblem(project: Project, item: Item): string | undefined {
    if (project.isDeleted) {
        return 'Project not found, or you do not have access to it.'
    }
    if (project.isArchived) {
        return 'Archived projects cannot be reordered or moved.'
    }
    if (!isWorkspaceProject(project) && project.inboxProject) {
        return 'The Inbox always comes first and cannot be reordered or moved.'
    }
    if (isWorkspaceProject(project) && item.parentId !== undefined) {
        return 'parentId is only supported for personal projects. Workspace projects are ordered within their folder; omit parentId to reorder it there.'
    }
    return undefined
}

/** Whether a project takes part in the ordering a user sees among its siblings. */
function isOrderable(project: Project): boolean {
    if (project.isDeleted || project.isArchived) return false
    return isWorkspaceProject(project) || !project.inboxProject
}

/**
 * Identifies the list a project is ordered in: personal projects among the
 * siblings under the same parent, workspace projects among the projects in the
 * same folder of the workspace's shared default ordering.
 */
function projectScope(project: Project): string {
    return isWorkspaceProject(project)
        ? `workspace:${project.workspaceId}:${project.folderId ?? 'root'}`
        : `personal:${project.parentId ?? 'root'}`
}

function toOrderedProject(project: Project): OrderedSibling {
    return isWorkspaceProject(project)
        ? {
              id: project.id,
              key: project.defaultOrderKey ?? null,
              legacyOrder: project.defaultOrder,
          }
        : { id: project.id, key: project.orderKey ?? null, legacyOrder: project.childOrder }
}

async function readProjects(client: TodoistApi): Promise<Map<string, Project>> {
    const response = await executeWithRetry(() =>
        client.sync({ resourceTypes: ['projects'], syncToken: '*' }),
    )
    return new Map((response.projects ?? []).map((project) => [project.id, project]))
}

async function readSections(client: TodoistApi): Promise<Map<string, Section>> {
    const response = await executeWithRetry(() =>
        client.sync({ resourceTypes: ['sections'], syncToken: '*' }),
    )
    return new Map((response.sections ?? []).map((section) => [section.id, section]))
}

export { reorderObjects }
