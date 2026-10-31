import type {
    PersonalProject,
    Section,
    SyncCommand,
    SyncRequest,
    TodoistApi,
    WorkspaceProject,
} from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import {
    createMockProject,
    createMockSection,
    createMockWorkspaceProject,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { reorderObjects } from './reorder-objects.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { REORDER_OBJECTS } = ToolNames

type CommandStatus = 'ok' | { error: string; httpCode: number; errorCode: number; errorTag: string }

/** What the mocked Sync API holds and how it answers each command. */
let state: {
    projects: Array<PersonalProject | WorkspaceProject>
    sections: Section[]
    /** Projects returned by reads made after the first command request, if they changed. */
    projectsAfterWrite?: Array<PersonalProject | WorkspaceProject>
    statusFor: (command: SyncCommand) => CommandStatus
}

/** Every command request sent, in order. */
function commandRequests(): SyncCommand[][] {
    return mockTodoistApi.sync.mock.calls
        .map(([request]) => request.commands)
        .filter((commands): commands is SyncCommand[] => commands !== undefined)
}

function sentCommands(): Array<{ type: string; args: unknown }> {
    return commandRequests()
        .flat()
        .map(({ type, args }) => ({ type, args }))
}

/** The args of a sent command, failing the test when no such command was sent. */
function sentArgs<T>(match: number | string): T {
    const commands = sentCommands()
    const command =
        typeof match === 'number'
            ? commands[match]
            : commands.find(({ args }) => (args as { id: string }).id === match)
    if (!command) {
        throw new Error(`No command was sent for ${match}`)
    }
    return command.args as T
}

function forbidden(): CommandStatus {
    return {
        error: 'Insufficient permissions',
        httpCode: 403,
        errorCode: 33,
        errorTag: 'FORBIDDEN',
    }
}

function personal(id: string, orderKey: string | null, overrides: Partial<PersonalProject> = {}) {
    return createMockProject({ id, orderKey, ...overrides })
}

function workspace(
    id: string,
    defaultOrderKey: string | null,
    overrides: Partial<WorkspaceProject> = {},
) {
    return createMockWorkspaceProject({ id, defaultOrderKey, ...overrides })
}

describe(`${REORDER_OBJECTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state = { projects: [], sections: [], statusFor: () => 'ok' }
        mockTodoistApi.sync.mockImplementation(async (request: SyncRequest) => {
            if (request.commands) {
                return {
                    syncStatus: Object.fromEntries(
                        request.commands.map((command) => [command.uuid, state.statusFor(command)]),
                    ),
                } as never
            }
            const projects =
                commandRequests().length > 0 && state.projectsAfterWrite
                    ? state.projectsAfterWrite
                    : state.projects
            return { projects, sections: state.sections } as never
        })
    })

    describe('project reordering', () => {
        it('re-keys only the placed project, among its siblings under the same parent', async () => {
            state.projects = [
                personal('inbox', 'Zz', { inboxProject: true }),
                personal('a', 'a0'),
                personal('b', 'a1'),
                personal('c', 'a2'),
                personal('archived', 'a0V', { isArchived: true }),
                personal('child', 'a0', { parentId: 'a' }),
                workspace('team', 'a0'),
            ]

            const result = await reorderObjects.execute(
                { type: 'project', items: [{ id: 'c', order: 0 }] },
                mockTodoistApi,
            )

            const commands = sentCommands()
            expect(commands).toEqual([
                { type: 'project_update', args: { id: 'c', orderKey: expect.any(String) } },
            ])
            const { orderKey } = sentArgs<{ orderKey: string }>(0)
            // Placed before 'a'; the Inbox, archived and other lists' projects are not its siblings.
            expect(orderKey < 'a0').toBe(true)
            expect(result.structuredContent).toEqual({
                type: 'project',
                movedCount: 0,
                reorderedCount: 1,
                affectedIds: ['c'],
                failures: [],
                success: true,
            })
            expect(result.textContent).toContain('reordered 1 projects: id=c')
        })

        it('orders workspace projects by their shared default key, within their folder', async () => {
            state.projects = [
                workspace('x', 'a0', { folderId: 'folder-1' }),
                workspace('y', 'a1', { folderId: 'folder-1' }),
                workspace('elsewhere', 'a0V', { folderId: 'folder-2' }),
            ]

            await reorderObjects.execute(
                { type: 'project', items: [{ id: 'y', order: 0 }] },
                mockTodoistApi,
            )

            const commands = sentCommands()
            expect(commands).toEqual([
                { type: 'project_update', args: { id: 'y', defaultOrderKey: expect.any(String) } },
            ])
            const { defaultOrderKey } = sentArgs<{ defaultOrderKey: string }>(0)
            expect(defaultOrderKey < 'a0').toBe(true)
        })

        it('sends personal and workspace key changes in one request', async () => {
            state.projects = [
                personal('a', 'a0'),
                personal('b', 'a1'),
                workspace('x', 'a0'),
                workspace('y', 'a1'),
            ]

            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'b', order: 0 },
                        { id: 'y', order: 0 },
                    ],
                },
                mockTodoistApi,
            )

            expect(commandRequests()).toHaveLength(1)
            expect(sentCommands()).toEqual([
                { type: 'project_update', args: { id: 'b', orderKey: expect.any(String) } },
                { type: 'project_update', args: { id: 'y', defaultOrderKey: expect.any(String) } },
            ])
            expect(result.structuredContent.reorderedCount).toBe(2)
        })

        it('writes nothing when the project is already in place', async () => {
            state.projects = [personal('a', 'a0'), personal('b', 'a1')]

            const result = await reorderObjects.execute(
                { type: 'project', items: [{ id: 'b', order: 1 }] },
                mockTodoistApi,
            )

            expect(commandRequests()).toHaveLength(0)
            expect(result.structuredContent).toMatchObject({ reorderedCount: 1, success: true })
        })

        it('moves first, then places the project among its new siblings', async () => {
            state.projects = [
                personal('parent', 'a0'),
                personal('p1', 'a0', { parentId: 'parent' }),
                personal('mover', 'a1'),
            ]
            state.projectsAfterWrite = [
                personal('parent', 'a0'),
                personal('p1', 'a0', { parentId: 'parent' }),
                personal('mover', 'a1', { parentId: 'parent' }),
            ]

            const result = await reorderObjects.execute(
                { type: 'project', items: [{ id: 'mover', parentId: 'parent', order: 0 }] },
                mockTodoistApi,
            )

            expect(commandRequests().map((commands) => commands.map((c) => c.type))).toEqual([
                ['project_move'],
                ['project_update'],
            ])
            expect(sentCommands()[0]).toEqual({
                type: 'project_move',
                args: { id: 'mover', parentId: 'parent' },
            })
            const { orderKey } = sentArgs<{ orderKey: string }>(1)
            expect(orderKey < 'a0').toBe(true)
            expect(result.structuredContent).toMatchObject({
                movedCount: 1,
                reorderedCount: 1,
                affectedIds: ['mover'],
                success: true,
            })
            expect(result.textContent).toContain('moved 1 and reordered 1 projects')
        })

        it('moves to the top level with "root"', async () => {
            state.projects = [personal('child', 'a0', { parentId: 'parent' })]

            await reorderObjects.execute(
                { type: 'project', items: [{ id: 'child', parentId: 'root' }] },
                mockTodoistApi,
            )

            expect(sentCommands()).toEqual([
                { type: 'project_move', args: { id: 'child', parentId: null } },
            ])
        })

        it('reports a failed move and skips reordering that project', async () => {
            state.projects = [personal('a', 'a0'), personal('b', 'a1')]
            state.statusFor = (command) => (command.type === 'project_move' ? forbidden() : 'ok')

            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'a', parentId: 'parent', order: 0 },
                        { id: 'b', order: 0 },
                    ],
                },
                mockTodoistApi,
            )

            expect(sentCommands().map((command) => command.type)).toEqual([
                'project_move',
                'project_update',
            ])
            expect(result.structuredContent).toMatchObject({
                movedCount: 0,
                reorderedCount: 1,
                affectedIds: ['b'],
                success: false,
            })
            expect(result.structuredContent.failures).toEqual([
                { item: 'a', error: expect.stringContaining('Insufficient permissions') },
            ])
        })

        it('reports each key change Todoist rejects, and keeps the ones it applied', async () => {
            state.projects = [
                personal('a', 'a0'),
                personal('b', 'a1'),
                workspace('x', 'a0'),
                workspace('y', 'a1'),
            ]
            state.statusFor = (command) =>
                (command.args as { defaultOrderKey?: string }).defaultOrderKey ? forbidden() : 'ok'

            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'b', order: 0 },
                        { id: 'y', order: 0 },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent).toMatchObject({
                reorderedCount: 1,
                affectedIds: ['b'],
                success: false,
            })
            expect(result.structuredContent.failures).toEqual([
                { item: 'y', error: expect.stringContaining('Insufficient permissions') },
            ])
            expect(result.textContent).toContain('y')
        })

        it.each([
            {
                name: 'an unknown project',
                project: undefined,
                item: { id: 'missing', order: 0 },
                error: 'Project not found',
            },
            {
                name: 'the Inbox',
                project: personal('missing', 'a0', { inboxProject: true }),
                item: { id: 'missing', order: 0 },
                error: 'The Inbox always comes first',
            },
            {
                name: 'an archived project',
                project: personal('missing', 'a0', { isArchived: true }),
                item: { id: 'missing', order: 0 },
                error: 'Archived projects cannot be reordered',
            },
            {
                name: 'a parentId on a workspace project',
                project: workspace('missing', 'a0'),
                item: { id: 'missing', parentId: 'parent', order: 0 },
                error: 'parentId is only supported for personal projects',
            },
        ])('fails only $name, and still reorders the rest', async ({ project, item, error }) => {
            state.projects = [
                personal('a', 'a0'),
                personal('b', 'a1'),
                ...(project ? [project] : []),
            ]

            const result = await reorderObjects.execute(
                { type: 'project', items: [item, { id: 'b', order: 0 }] },
                mockTodoistApi,
            )

            expect(sentCommands()).toEqual([
                { type: 'project_update', args: { id: 'b', orderKey: expect.any(String) } },
            ])
            expect(result.structuredContent.failures).toEqual([
                { item: 'missing', error: expect.stringContaining(error) },
            ])
            expect(result.structuredContent.affectedIds).toEqual(['b'])
        })

        it('reports every item when the moved projects cannot be read back', async () => {
            state.projects = [personal('a', 'a0'), personal('b', 'a1')]
            let reads = 0
            mockTodoistApi.sync.mockImplementation(async (request: SyncRequest) => {
                if (request.commands) {
                    return {
                        syncStatus: Object.fromEntries(request.commands.map((c) => [c.uuid, 'ok'])),
                    } as never
                }
                reads += 1
                if (reads > 1) throw new Error('Service unavailable')
                return { projects: state.projects } as never
            })

            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'a', parentId: 'parent', order: 0 },
                        { id: 'b', order: 0 },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent).toMatchObject({
                movedCount: 1,
                reorderedCount: 0,
                affectedIds: ['a'],
                success: false,
            })
            expect(result.structuredContent.failures).toEqual([
                {
                    item: 'a',
                    error: expect.stringMatching(/^Moved, but its new siblings could not be read/),
                },
                {
                    item: 'b',
                    error: expect.stringMatching(/^Its siblings could not be read/),
                },
            ])
        })

        it('does not count a moved project as reordered when it is missing after the move', async () => {
            state.projects = [personal('a', 'a0'), personal('mover', 'a1')]
            state.projectsAfterWrite = [personal('a', 'a0')]

            const result = await reorderObjects.execute(
                { type: 'project', items: [{ id: 'mover', parentId: 'parent', order: 0 }] },
                mockTodoistApi,
            )

            expect(result.structuredContent).toMatchObject({
                movedCount: 1,
                reorderedCount: 0,
                affectedIds: ['mover'],
                success: false,
            })
            expect(result.structuredContent.failures).toEqual([
                { item: 'mover', error: 'Project not found after moving it.' },
            ])
        })

        it('re-keys the whole list when a sibling has no key, reporting siblings under their own IDs', async () => {
            state.projects = [
                personal('a', null, { childOrder: 1 }),
                personal('b', 'a5', { childOrder: 2 }),
                personal('c', 'a1', { childOrder: 3 }),
            ]
            state.statusFor = (command) =>
                (command.args as { id: string }).id === 'a' ? forbidden() : 'ok'

            const result = await reorderObjects.execute(
                { type: 'project', items: [{ id: 'c', order: 0 }] },
                mockTodoistApi,
            )

            const commands = sentCommands()
            expect(commandRequests()).toHaveLength(1)
            expect(commands.map((command) => (command.args as { id: string }).id).sort()).toEqual([
                'a',
                'b',
                'c',
            ])
            // Read back in the legacy order with c moved to the front.
            const keyOf = (id: string) => sentArgs<{ orderKey: string }>(id).orderKey
            expect(keyOf('c') < keyOf('a') && keyOf('a') < keyOf('b')).toBe(true)
            expect(result.structuredContent).toEqual({
                type: 'project',
                movedCount: 0,
                reorderedCount: 1,
                affectedIds: ['c'],
                failures: [
                    { item: 'a', error: expect.stringContaining('Insufficient permissions') },
                ],
                success: false,
            })
        })

        it('fails the whole call when the projects cannot be read before any write', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error('Invalid token'))

            await expect(
                reorderObjects.execute(
                    { type: 'project', items: [{ id: 'a', order: 0 }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Invalid token')
        })
    })

    describe('section reordering', () => {
        it('re-keys the placed section among the sections of its project', async () => {
            state.sections = [
                createMockSection({ id: 's1', projectId: 'p', orderKey: 'a0' }),
                createMockSection({ id: 's2', projectId: 'p', orderKey: 'a1' }),
                createMockSection({ id: 'other', projectId: 'q', orderKey: 'a0V' }),
            ]

            const result = await reorderObjects.execute(
                { type: 'section', items: [{ id: 's2', order: 0 }] },
                mockTodoistApi,
            )

            const commands = sentCommands()
            expect(commands).toEqual([
                { type: 'section_update', args: { id: 's2', orderKey: expect.any(String) } },
            ])
            const { orderKey } = sentArgs<{ orderKey: string }>(0)
            expect(orderKey < 'a0').toBe(true)
            expect(result.structuredContent).toEqual({
                type: 'section',
                movedCount: 0,
                reorderedCount: 1,
                affectedIds: ['s2'],
                failures: [],
                success: true,
            })
            expect(result.textContent).toContain('reordered 1 sections: id=s2')
        })

        it('reports a section it cannot find', async () => {
            const result = await reorderObjects.execute(
                { type: 'section', items: [{ id: 'missing', order: 0 }] },
                mockTodoistApi,
            )

            expect(commandRequests()).toHaveLength(0)
            expect(result.structuredContent.failures).toEqual([
                { item: 'missing', error: expect.stringContaining('Section not found') },
            ])
            expect(result.structuredContent.success).toBe(false)
        })
    })

    describe('validation', () => {
        afterEach(() => {
            expect(mockTodoistApi.sync).not.toHaveBeenCalled()
        })

        it('should throw when parentId is used with section type', async () => {
            await expect(
                reorderObjects.execute(
                    { type: 'section', items: [{ id: 'sec-1', parentId: 'proj-1' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('parentId is only supported when type is "project"')
        })

        it('should throw on duplicate IDs', async () => {
            await expect(
                reorderObjects.execute(
                    {
                        type: 'project',
                        items: [
                            { id: 'proj-1', order: 0 },
                            { id: 'proj-1', order: 1 },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Duplicate item id=proj-1')
        })

        it('should throw when item has neither order nor parentId', async () => {
            await expect(
                reorderObjects.execute(
                    { type: 'project', items: [{ id: 'proj-1' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('must have at least one of "order" or "parentId"')
        })
    })
})
