import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { reorderObjects } from './reorder-objects.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { REORDER_OBJECTS } = ToolNames

describe(`${REORDER_OBJECTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.sync.mockResolvedValue({ syncStatus: {} })
    })

    describe('project reordering', () => {
        it('should reorder projects with correct Sync API command', async () => {
            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'proj-1', order: 0 },
                        { id: 'proj-2', order: 1 },
                        { id: 'proj-3', order: 2 },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'project_reorder',
                        args: {
                            projects: [
                                { id: 'proj-1', childOrder: 0 },
                                { id: 'proj-2', childOrder: 1 },
                                { id: 'proj-3', childOrder: 2 },
                            ],
                        },
                    }),
                ],
            })

            expect(result.structuredContent).toEqual({
                type: 'project',
                movedCount: 0,
                reorderedCount: 3,
                affectedIds: ['proj-1', 'proj-2', 'proj-3'],
                success: true,
            })
            expect(result.textContent).toContain('reordered 3 projects')
        })

        it('should map order field to childOrder for projects', async () => {
            await reorderObjects.execute(
                {
                    type: 'project',
                    items: [{ id: 'proj-1', order: 5 }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'project_reorder',
                        args: { projects: [{ id: 'proj-1', childOrder: 5 }] },
                    }),
                ],
            })
        })
    })

    describe('section reordering', () => {
        it('should reorder sections with correct Sync API command', async () => {
            const result = await reorderObjects.execute(
                {
                    type: 'section',
                    items: [
                        { id: 'sec-1', order: 0 },
                        { id: 'sec-2', order: 1 },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'section_reorder',
                        args: {
                            sections: [
                                { id: 'sec-1', sectionOrder: 0 },
                                { id: 'sec-2', sectionOrder: 1 },
                            ],
                        },
                    }),
                ],
            })

            expect(result.structuredContent).toEqual({
                type: 'section',
                movedCount: 0,
                reorderedCount: 2,
                affectedIds: ['sec-1', 'sec-2'],
                success: true,
            })
            expect(result.textContent).toContain('reordered 2 sections')
        })

        it('should map order field to sectionOrder for sections', async () => {
            await reorderObjects.execute(
                {
                    type: 'section',
                    items: [{ id: 'sec-1', order: 3 }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'section_reorder',
                        args: { sections: [{ id: 'sec-1', sectionOrder: 3 }] },
                    }),
                ],
            })
        })
    })

    describe('project move (parentId)', () => {
        it('should move a project under a new parent', async () => {
            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [{ id: 'proj-1', parentId: 'parent-1' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'project_move',
                        args: { id: 'proj-1', parentId: 'parent-1' },
                    }),
                ],
            })

            expect(result.structuredContent).toEqual({
                type: 'project',
                movedCount: 1,
                reorderedCount: 0,
                affectedIds: ['proj-1'],
                success: true,
            })
            expect(result.textContent).toContain('moved 1')
        })

        it('should move a project to root level when parentId is "root"', async () => {
            await reorderObjects.execute(
                {
                    type: 'project',
                    items: [{ id: 'proj-1', parentId: 'root' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'project_move',
                        args: { id: 'proj-1', parentId: null },
                    }),
                ],
            })
        })

        it('should move and reorder in a single sync call', async () => {
            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'proj-1', parentId: 'parent-1', order: 0 },
                        { id: 'proj-2', parentId: 'parent-1', order: 1 },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledOnce()
            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'project_move',
                        args: { id: 'proj-1', parentId: 'parent-1' },
                    }),
                    expect.objectContaining({
                        type: 'project_move',
                        args: { id: 'proj-2', parentId: 'parent-1' },
                    }),
                    expect.objectContaining({
                        type: 'project_reorder',
                        args: {
                            projects: [
                                { id: 'proj-1', childOrder: 0 },
                                { id: 'proj-2', childOrder: 1 },
                            ],
                        },
                    }),
                ],
            })

            expect(result.structuredContent).toEqual({
                type: 'project',
                movedCount: 2,
                reorderedCount: 2,
                affectedIds: ['proj-1', 'proj-2'],
                success: true,
            })
            expect(result.textContent).toContain('moved 2 and reordered 2 projects')
        })

        it('should place move commands before reorder commands', async () => {
            await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'proj-1', order: 0 },
                        { id: 'proj-2', parentId: 'parent-1' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({ type: 'project_move' }),
                    expect.objectContaining({ type: 'project_reorder' }),
                ],
            })
        })
    })

    describe('validation', () => {
        it('should throw when parentId is used with section type', async () => {
            await expect(
                reorderObjects.execute(
                    {
                        type: 'section',
                        items: [{ id: 'sec-1', parentId: 'parent-1' }],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('parentId is only supported when type is "project"')
        })

        it('should throw when duplicate item IDs are provided', async () => {
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
                    {
                        type: 'project',
                        items: [{ id: 'proj-1' }],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('must have at least one of "order" or "parentId"')
        })
    })

    describe('error handling', () => {
        it('should throw with contextual message when sync fails', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error('Sync API error: invalid command'))

            await expect(
                reorderObjects.execute(
                    {
                        type: 'project',
                        items: [{ id: 'proj-1', order: 0 }],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Reorder failed: Sync API error: invalid command')
        })

        it('should handle non-Error exceptions', async () => {
            mockTodoistApi.sync.mockRejectedValue('unexpected failure')

            await expect(
                reorderObjects.execute(
                    {
                        type: 'section',
                        items: [{ id: 'sec-1', order: 0 }],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Reorder failed: unexpected failure')
        })
    })

    describe('output format', () => {
        it('should return correct text for reorder only', async () => {
            const result = await reorderObjects.execute(
                {
                    type: 'section',
                    items: [
                        { id: 'sec-a', order: 0 },
                        { id: 'sec-b', order: 1 },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.textContent).toBe('reordered 2 sections: id=sec-a, id=sec-b')
        })

        it('should return correct text for move only', async () => {
            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [{ id: 'proj-1', parentId: 'parent-1' }],
                },
                mockTodoistApi,
            )

            expect(result.textContent).toBe('moved 1 projects: id=proj-1')
        })

        it('should return correct text for move and reorder', async () => {
            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [{ id: 'proj-1', parentId: 'parent-1', order: 0 }],
                },
                mockTodoistApi,
            )

            expect(result.textContent).toBe('moved 1 and reordered 1 projects: id=proj-1')
        })
    })
})
