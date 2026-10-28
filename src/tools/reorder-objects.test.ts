import { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockProject, createMockWorkspaceProject } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { reorderObjects } from './reorder-objects.js'

const mockTodoistApi = {
    getProject: vi.fn(),
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { REORDER_OBJECTS } = ToolNames

describe(`${REORDER_OBJECTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getProject.mockImplementation(async (id) => createMockProject({ id }))
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

        it('should reorder workspace projects without changing their folders', async () => {
            mockTodoistApi.getProject
                .mockResolvedValueOnce(
                    createMockWorkspaceProject({ id: 'workspace-root', workspaceId: 'team-1' }),
                )
                .mockResolvedValueOnce(
                    createMockWorkspaceProject({
                        id: 'workspace-folder',
                        workspaceId: 'team-1',
                        folderId: 'folder-1',
                        defaultOrder: 9,
                    }),
                )

            await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'workspace-root', order: 1 },
                        { id: 'workspace-folder', order: 0 },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledOnce()
            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'workspace_set_default_project_ordering',
                        args: {
                            workspaceId: 'team-1',
                            projects: [
                                { id: 'workspace-root', defaultOrder: 1 },
                                { id: 'workspace-folder', defaultOrder: 0 },
                            ],
                            folders: [],
                        },
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
            expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
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

        it('should batch personal moves with personal and workspace reorders', async () => {
            mockTodoistApi.getProject
                .mockResolvedValueOnce(createMockProject({ id: 'proj-1' }))
                .mockResolvedValueOnce(createMockProject({ id: 'proj-2' }))
                .mockResolvedValueOnce(
                    createMockWorkspaceProject({ id: 'team-1-proj', workspaceId: 'team-1' }),
                )
                .mockResolvedValueOnce(
                    createMockWorkspaceProject({ id: 'team-2-proj', workspaceId: 'team-2' }),
                )

            const result = await reorderObjects.execute(
                {
                    type: 'project',
                    items: [
                        { id: 'proj-1', parentId: 'parent-1', order: 0 },
                        { id: 'proj-2', parentId: 'parent-1', order: 1 },
                        { id: 'team-1-proj', order: 1 },
                        { id: 'team-2-proj', order: 0 },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProject.mock.calls).toEqual([
                ['proj-1'],
                ['proj-2'],
                ['team-1-proj'],
                ['team-2-proj'],
            ])
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
                    expect.objectContaining({
                        type: 'workspace_set_default_project_ordering',
                        args: {
                            workspaceId: 'team-1',
                            projects: [{ id: 'team-1-proj', defaultOrder: 1 }],
                            folders: [],
                        },
                    }),
                    expect.objectContaining({
                        type: 'workspace_set_default_project_ordering',
                        args: {
                            workspaceId: 'team-2',
                            projects: [{ id: 'team-2-proj', defaultOrder: 0 }],
                            folders: [],
                        },
                    }),
                ],
            })

            expect(result.structuredContent).toEqual({
                type: 'project',
                movedCount: 2,
                reorderedCount: 4,
                affectedIds: ['proj-1', 'proj-2', 'team-1-proj', 'team-2-proj'],
                success: true,
            })
            expect(result.textContent).toContain('moved 2 and reordered 4 projects')
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

        it.each([{ parentId: 'root' }, { parentId: 'parent-1', order: 0 }])(
            'should reject workspace parentId=$parentId before any writes',
            async (move) => {
                mockTodoistApi.getProject
                    .mockResolvedValueOnce(createMockProject({ id: 'proj-1' }))
                    .mockResolvedValueOnce(createMockWorkspaceProject({ id: 'workspace-proj' }))

                await expect(
                    reorderObjects.execute(
                        {
                            type: 'project',
                            items: [
                                { id: 'proj-1', parentId: 'root', order: 0 },
                                { id: 'workspace-proj', ...move },
                            ],
                        },
                        mockTodoistApi,
                    ),
                ).rejects.toThrow(
                    'Reorder failed: parentId is only supported for personal projects',
                )
                expect(mockTodoistApi.sync).not.toHaveBeenCalled()
            },
        )
    })

    describe('validation', () => {
        afterEach(() => {
            expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.sync).not.toHaveBeenCalled()
        })

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
        it('should fail before any writes if a project lookup fails', async () => {
            mockTodoistApi.getProject
                .mockResolvedValueOnce(createMockProject({ id: 'proj-1' }))
                .mockRejectedValueOnce(new Error('Project not found'))

            await expect(
                reorderObjects.execute(
                    {
                        type: 'project',
                        items: [
                            { id: 'proj-1', parentId: 'root', order: 0 },
                            { id: 'missing-project', order: 1 },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Reorder failed: Project not found')
            expect(mockTodoistApi.sync).not.toHaveBeenCalled()
        })

        it('should serialize workspace ordering and reject SDK permission errors', async () => {
            let sentCommands: unknown
            const client = new TodoistApi('unused-test-token', {
                baseUrl: 'https://todoist.invalid',
                customFetch: async (_url, init) => {
                    const { commands } = JSON.parse(String(init?.body)) as {
                        commands: { uuid: string }[]
                    }
                    sentCommands = commands
                    const response = Response.json({
                        sync_status: Object.fromEntries(
                            commands.map(({ uuid }) => [
                                uuid,
                                {
                                    error: 'Insufficient permissions',
                                    http_code: 403,
                                    error_extra: {},
                                },
                            ]),
                        ),
                    })
                    return {
                        ok: response.ok,
                        status: response.status,
                        statusText: response.statusText,
                        headers: Object.fromEntries(response.headers),
                        text: () => response.text(),
                        json: () => response.json(),
                    }
                },
            })
            vi.spyOn(client, 'getProject').mockResolvedValue(
                createMockWorkspaceProject({
                    id: 'workspace-proj',
                    workspaceId: 'team-1',
                    folderId: 'folder-1',
                }),
            )

            await expect(
                reorderObjects.execute(
                    { type: 'project', items: [{ id: 'workspace-proj', order: 0 }] },
                    client,
                ),
            ).rejects.toThrow('Reorder failed: Insufficient permissions')
            expect(sentCommands).toEqual([
                expect.objectContaining({
                    type: 'workspace_set_default_project_ordering',
                    args: {
                        workspace_id: 'team-1',
                        projects: [{ id: 'workspace-proj', default_order: 0 }],
                        folders: [],
                    },
                }),
            ])
        })

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
