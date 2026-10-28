import type { SyncCommand } from '@doist/todoist-sdk'
import { createCommand, isWorkspaceProject } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const reorderableTypes = ['project', 'section'] as const

const ArgsSchema = {
    type: z
        .enum(reorderableTypes)
        .describe(
            'The type of entity to reorder. ' +
                '"project" reorders personal sibling projects or workspace projects within their current folder (and can move personal projects to a new parent). ' +
                '"section" reorders sections within the same project.',
        ),
    items: z
        .array(
            z.object({
                id: z.string().min(1).describe('The ID of the entity.'),
                order: z
                    .number()
                    .int()
                    .min(0)
                    .optional()
                    .describe(
                        'The new order value. Lower values appear first. Sets personal project/section order or workspace shared default order.',
                    ),
                parentId: z
                    .string()
                    .min(1)
                    .optional()
                    .describe(
                        'Move a personal project under this parent project ID, or use "root" for the top level. ' +
                            'Only valid for personal projects when type is "project"; not for workspace folders.',
                    ),
            }),
        )
        .min(1)
        .describe(
            'The items to reorder or move. Each item must have at least order or parentId. ' +
                'Personal project moves happen first, then items with order are reordered. ' +
                'All items being reordered should be siblings for predictable results.',
        ),
}

const OutputSchema = {
    type: z.enum(reorderableTypes).describe('The type of entity that was reordered/moved.'),
    movedCount: z.number().describe('The number of entities moved to a new parent.'),
    reorderedCount: z.number().describe('The number of entities reordered.'),
    affectedIds: z.array(z.string()).describe('The IDs of all affected entities.'),
    success: z.boolean().describe('Whether the operation was successful.'),
}

const reorderObjects = {
    name: ToolNames.REORDER_OBJECTS,
    description:
        'Reorder projects or sections, and optionally move personal projects to a new parent. ' +
        'For personal projects: set order to reorder siblings, and/or parentId to move under a new parent (use "root" for top level). ' +
        'For workspace projects: order sets the shared default ordering, which can affect other members; requires ordering permission and preserves the existing folder. parentId is not supported. ' +
        'For sections: set order to reorder within a project.',
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

        const commands: SyncCommand[] = []
        const itemsToMove = items.filter((item) => item.parentId !== undefined)
        const itemsToReorder = items.filter(
            (item): item is typeof item & { order: number } => item.order !== undefined,
        )

        try {
            // Classify each project once per invocation and finish preflight before any writes.
            const workspaceIdByProjectId = new Map<string, string>()
            if (type === 'project') {
                for (const item of items) {
                    const project = await client.getProject(item.id)
                    if (isWorkspaceProject(project)) {
                        if (item.parentId !== undefined) {
                            throw new Error(
                                `parentId is only supported for personal projects, not workspace project id=${item.id}. Omit parentId to reorder without changing its folder.`,
                            )
                        }
                        workspaceIdByProjectId.set(item.id, project.workspaceId)
                    }
                }
            }

            // Project moves first so reordering applies to the new parent context.
            for (const item of itemsToMove) {
                const parentId = item.parentId
                commands.push(
                    createCommand('project_move', {
                        id: item.id,
                        parentId: parentId === 'root' ? null : parentId,
                    }),
                )
            }

            if (type === 'project') {
                const personalReorders: { id: string; childOrder: number }[] = []
                const workspaceReorders = new Map<string, { id: string; defaultOrder: number }[]>()
                for (const item of itemsToReorder) {
                    const workspaceId = workspaceIdByProjectId.get(item.id)
                    if (workspaceId === undefined) {
                        personalReorders.push({ id: item.id, childOrder: item.order })
                    } else {
                        const projects = workspaceReorders.get(workspaceId) ?? []
                        // Omit folderId: even null would move the project out of its folder.
                        projects.push({ id: item.id, defaultOrder: item.order })
                        workspaceReorders.set(workspaceId, projects)
                    }
                }
                if (personalReorders.length > 0) {
                    commands.push(createCommand('project_reorder', { projects: personalReorders }))
                }
                for (const [workspaceId, projects] of workspaceReorders) {
                    commands.push(
                        createCommand('workspace_set_default_project_ordering', {
                            workspaceId,
                            projects,
                            folders: [],
                        }),
                    )
                }
            } else if (itemsToReorder.length > 0) {
                commands.push(
                    createCommand('section_reorder', {
                        sections: itemsToReorder.map((item) => ({
                            id: item.id,
                            sectionOrder: item.order,
                        })),
                    }),
                )
            }

            // The SDK throws TodoistRequestError for non-ok syncStatus entries.
            await client.sync({ commands })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`Reorder failed: ${message}`)
        }

        const entityLabel = type === 'project' ? 'projects' : 'sections'
        const affectedIds = items.map((item) => item.id)
        const parts: string[] = []
        if (itemsToMove.length > 0) {
            parts.push(`moved ${itemsToMove.length}`)
        }
        if (itemsToReorder.length > 0) {
            parts.push(`reordered ${itemsToReorder.length}`)
        }

        return {
            textContent: `${parts.join(' and ')} ${entityLabel}: ${affectedIds.map((id) => `id=${id}`).join(', ')}`,
            structuredContent: {
                type,
                movedCount: itemsToMove.length,
                reorderedCount: itemsToReorder.length,
                affectedIds,
                success: true,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { reorderObjects }
