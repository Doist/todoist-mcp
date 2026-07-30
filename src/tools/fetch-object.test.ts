import type { Comment, Section, Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import {
    createMockProject,
    createMockTask,
    createMockWorkspaceProject,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { fetchObject } from './fetch-object.js'

// Mock the Todoist API
const mockTodoistApi = {
    getTask: vi.fn(),
    getProject: vi.fn(),
    getComment: vi.fn(),
    getSection: vi.fn(),
    getTasks: vi.fn(),
    getProjects: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FETCH_OBJECT } = ToolNames

// Test data constants
const MOCK_SECTION: Section = {
    id: 'section123',
    name: 'My Section',
    description: 'Section notes',
    projectId: 'project123',
    sectionOrder: 1,
    userId: 'user123',
    addedAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    archivedAt: null,
    isArchived: false,
    isDeleted: false,
    isCollapsed: false,
    url: 'https://todoist.com/sections/section123',
}

function createMockComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: 'comment123',
        content: 'Test comment content',
        postedAt: new Date('2024-01-01T12:00:00Z'),
        postedUid: 'user123',
        taskId: 'task123',
        projectId: undefined,
        fileAttachment: null,
        uidsToNotify: null,
        reactions: null,
        isDeleted: false,
        ...overrides,
    }
}

describe(`${FETCH_OBJECT} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('fetching tasks', () => {
        it('should fetch a task by ID', async () => {
            const mockTask = createMockTask({
                id: 'task123',
                content: 'My test task',
                priority: 'p1',
                projectId: 'project123',
            })
            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetchObject.execute(
                { type: 'task', id: 'task123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getTask).toHaveBeenCalledWith('task123')
            expect(result.textContent).toContain('Found task: My test task')
            expect(result.textContent).toContain('id=task123')
            expect(result.textContent).toContain('priority=p1')
            expect(result.textContent).toContain('project=project123')

            expect(result.structuredContent).toEqual({
                type: 'task',
                id: 'task123',
                object: expect.objectContaining({
                    id: 'task123',
                    content: 'My test task',
                    projectId: 'project123',
                }),
            })
        })

        it('should handle task not found', async () => {
            mockTodoistApi.getTask.mockRejectedValue(new Error('Task not found'))

            await expect(
                fetchObject.execute({ type: 'task', id: 'invalid' }, mockTodoistApi),
            ).rejects.toThrow('Failed to fetch task with id invalid')
        })
    })

    describe('fetching projects', () => {
        it('should fetch a project by ID', async () => {
            const mockProject = createMockProject({
                id: 'project123',
                name: 'My Project',
                color: 'red',
                viewStyle: 'board',
            })
            mockTodoistApi.getProject.mockResolvedValue(mockProject)

            const result = await fetchObject.execute(
                { type: 'project', id: 'project123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProject).toHaveBeenCalledWith('project123')
            expect(result.textContent).toContain('Found project: My Project')
            expect(result.textContent).toContain('id=project123')
            expect(result.textContent).toContain('color=red')
            expect(result.textContent).toContain('viewStyle=board')

            expect(result.structuredContent).toEqual({
                type: 'project',
                id: 'project123',
                object: expect.objectContaining({
                    id: 'project123',
                    name: 'My Project',
                    color: 'red',
                    viewStyle: 'board',
                }),
            })
        })

        it('should handle project not found', async () => {
            mockTodoistApi.getProject.mockRejectedValue(new Error('Project not found'))

            await expect(
                fetchObject.execute({ type: 'project', id: 'invalid' }, mockTodoistApi),
            ).rejects.toThrow('Failed to fetch project with id invalid')
        })
    })

    describe('fetching comments', () => {
        it('should fetch a comment by ID', async () => {
            const mockComment = createMockComment({
                id: 'comment123',
                content: 'This is a test comment',
            })
            mockTodoistApi.getComment.mockResolvedValue(mockComment)

            const result = await fetchObject.execute(
                { type: 'comment', id: 'comment123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getComment).toHaveBeenCalledWith('comment123')
            expect(result.textContent).toContain('Found comment')
            expect(result.textContent).toContain('id=comment123')
            expect(result.textContent).toContain('This is a test comment')
            expect(result.textContent).toContain('posted=2024-01-01T12:00:00.000Z')

            expect(result.structuredContent).toEqual({
                type: 'comment',
                id: 'comment123',
                object: expect.objectContaining({
                    id: 'comment123',
                    content: 'This is a test comment',
                    postedAt: '2024-01-01T12:00:00.000Z',
                }),
            })
        })

        it('should truncate long comment content in textContent', async () => {
            const longContent =
                'This is a very long comment that exceeds fifty characters and should be truncated'
            const mockComment = createMockComment({
                id: 'comment123',
                content: longContent,
            })
            mockTodoistApi.getComment.mockResolvedValue(mockComment)

            const result = await fetchObject.execute(
                { type: 'comment', id: 'comment123' },
                mockTodoistApi,
            )

            // Should truncate at 50 chars + "..."
            expect(result.textContent).toContain('This is a very long comment that exceeds fifty')
            expect(result.textContent).toContain('...')
            expect(result.textContent).not.toContain('characters and should be truncated')

            // Structured content should have full content
            expect(result.structuredContent?.object).toMatchObject({
                content: longContent,
            })
        })

        it('should handle comment not found', async () => {
            mockTodoistApi.getComment.mockRejectedValue(new Error('Comment not found'))

            await expect(
                fetchObject.execute({ type: 'comment', id: 'invalid' }, mockTodoistApi),
            ).rejects.toThrow('Failed to fetch comment with id invalid')
        })
    })

    describe('fetching sections', () => {
        it('should fetch a section by ID', async () => {
            mockTodoistApi.getSection.mockResolvedValue(MOCK_SECTION)

            const result = await fetchObject.execute(
                { type: 'section', id: 'section123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getSection).toHaveBeenCalledWith('section123')
            expect(result.textContent).toContain('Found section: My Section')
            expect(result.textContent).toContain('id=section123')

            expect(result.structuredContent).toEqual({
                type: 'section',
                id: 'section123',
                object: {
                    id: 'section123',
                    name: 'My Section',
                    sectionOrder: 1,
                    description: 'Section notes',
                },
            })
        })

        it('should handle section not found (null response)', async () => {
            mockTodoistApi.getSection.mockResolvedValue(null as unknown as Section)

            await expect(
                fetchObject.execute({ type: 'section', id: 'section123' }, mockTodoistApi),
            ).rejects.toThrow('Section section123 not found.')
        })

        it('should handle API error when fetching sections', async () => {
            mockTodoistApi.getSection.mockRejectedValue(new Error('API error'))

            await expect(
                fetchObject.execute({ type: 'section', id: 'section123' }, mockTodoistApi),
            ).rejects.toThrow('Failed to fetch section with id section123: API error')
        })
    })

    describe('includeChildren', () => {
        /**
         * The children fields only exist on the task and project branches of the
         * structured content union, so narrow to them before asserting on one.
         */
        function childrenOf(result: Awaited<ReturnType<typeof fetchObject.execute>>) {
            return (result.structuredContent ?? {}) as {
                childCount?: number
                children?: Record<string, unknown>[]
                hasMoreChildren?: boolean
                childrenError?: string
            }
        }

        /** Answers the direct-children call for `parentId`, and treats every other task as a leaf. */
        function mockSubtasksOf(
            parentId: string,
            subtasks: Task[],
            nextCursor: string | null = null,
        ) {
            mockTodoistApi.getTasks.mockImplementation(async (args) =>
                args?.parentId === parentId
                    ? { results: subtasks, nextCursor }
                    : { results: [], nextCursor: null },
            )
        }

        describe('for tasks', () => {
            beforeEach(() => {
                mockTodoistApi.getTask.mockResolvedValue(createMockTask({ id: 'task123' }))
            })

            it('should not look up children unless asked', async () => {
                const result = await fetchObject.execute(
                    { type: 'task', id: 'task123' },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.getTasks).not.toHaveBeenCalled()
                expect(result.structuredContent).not.toHaveProperty('childCount')
                expect(result.structuredContent).not.toHaveProperty('children')
            })

            it('should report zero children for a leaf task', async () => {
                mockSubtasksOf('task123', [])

                const result = await fetchObject.execute(
                    { type: 'task', id: 'task123', includeChildren: true },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.getTasks).toHaveBeenCalledTimes(1)
                expect(mockTodoistApi.getTasks).toHaveBeenCalledWith({
                    parentId: 'task123',
                    limit: 25,
                })
                expect(result.structuredContent).toMatchObject({ childCount: 0, children: [] })
                expect(result.textContent).toContain('subtasks=0')
            })

            it('should return compact subtasks and flag the ones that nest further', async () => {
                const undatedSubtask = createMockTask({ id: 'sub1', content: 'Undated subtask' })
                const datedSubtask = createMockTask({
                    id: 'sub2',
                    content: 'Dated subtask',
                    checked: true,
                    due: {
                        isRecurring: false,
                        string: '2 Aug',
                        date: '2026-08-02',
                        timezone: null,
                        lang: 'en',
                    },
                })
                mockTodoistApi.getTasks.mockImplementation(async (args) => {
                    if (args?.parentId === 'task123') {
                        return { results: [undatedSubtask, datedSubtask], nextCursor: null }
                    }
                    if (args?.parentId === 'sub1') {
                        return {
                            results: [createMockTask({ id: 'grandchild' })],
                            nextCursor: null,
                        }
                    }
                    return { results: [], nextCursor: null }
                })

                const result = await fetchObject.execute(
                    { type: 'task', id: 'task123', includeChildren: true },
                    mockTodoistApi,
                )

                // One call for the children, then one cheap probe per child.
                expect(mockTodoistApi.getTasks).toHaveBeenCalledTimes(3)
                expect(mockTodoistApi.getTasks).toHaveBeenCalledWith({
                    parentId: 'sub1',
                    limit: 1,
                })
                expect(result.structuredContent).toMatchObject({
                    childCount: 2,
                    children: [
                        {
                            id: 'sub1',
                            content: 'Undated subtask',
                            checked: false,
                            hasChildren: true,
                        },
                        {
                            id: 'sub2',
                            content: 'Dated subtask',
                            dueDate: '2026-08-02',
                            checked: true,
                            hasChildren: false,
                        },
                    ],
                })
                expect(childrenOf(result).children?.[0]).toHaveProperty('dueDate', undefined)
                expect(result.textContent).toContain('subtasks=2')
            })

            it('should flag a truncated child list', async () => {
                const subtasks = Array.from({ length: 25 }, (_, index) =>
                    createMockTask({ id: `sub${index}` }),
                )
                mockSubtasksOf('task123', subtasks, 'next-page')

                const result = await fetchObject.execute(
                    { type: 'task', id: 'task123', includeChildren: true },
                    mockTodoistApi,
                )

                expect(childrenOf(result).children).toHaveLength(25)
                expect(result.structuredContent).toMatchObject({
                    childCount: 25,
                    hasMoreChildren: true,
                })
                expect(result.textContent).toContain('subtasks=25+')
            })

            it('should report a failed children lookup without failing the fetch', async () => {
                mockTodoistApi.getTasks.mockRejectedValue(new Error('Rate limited'))

                const result = await fetchObject.execute(
                    { type: 'task', id: 'task123', includeChildren: true },
                    mockTodoistApi,
                )

                expect(result.structuredContent?.object).toMatchObject({ id: 'task123' })
                expect(childrenOf(result).childrenError).toBe('Rate limited')
                expect(result.structuredContent).not.toHaveProperty('childCount')
                expect(result.textContent).toContain('subtasks=unavailable')
            })

            it('should report a failed grandchild probe without failing the fetch', async () => {
                mockTodoistApi.getTasks.mockImplementation(async (args) => {
                    if (args?.parentId === 'task123') {
                        return { results: [createMockTask({ id: 'sub1' })], nextCursor: null }
                    }
                    throw new Error('Probe failed')
                })

                const result = await fetchObject.execute(
                    { type: 'task', id: 'task123', includeChildren: true },
                    mockTodoistApi,
                )

                expect(childrenOf(result).childrenError).toBe('Probe failed')
                expect(result.structuredContent).not.toHaveProperty('childCount')
            })
        })

        describe('for projects', () => {
            it('should return sub-projects in child order, flagging the ones that nest further', async () => {
                mockTodoistApi.getProject.mockResolvedValue(createMockProject({ id: 'parent' }))
                mockTodoistApi.getProjects.mockResolvedValue({
                    results: [
                        createMockProject({
                            id: 'childB',
                            name: 'B',
                            parentId: 'parent',
                            childOrder: 2,
                        }),
                        createMockProject({
                            id: 'childA',
                            name: 'A',
                            parentId: 'parent',
                            childOrder: 1,
                        }),
                        createMockProject({ id: 'grandchild', name: 'A1', parentId: 'childA' }),
                        createMockProject({ id: 'unrelated', name: 'Elsewhere' }),
                    ],
                    nextCursor: null,
                })

                const result = await fetchObject.execute(
                    { type: 'project', id: 'parent', includeChildren: true },
                    mockTodoistApi,
                )

                expect(result.structuredContent).toMatchObject({
                    childCount: 2,
                    children: [
                        { id: 'childA', name: 'A', hasChildren: true },
                        { id: 'childB', name: 'B', hasChildren: false },
                    ],
                })
                expect(result.textContent).toContain('subProjects=2')
            })

            it('should report zero sub-projects for a leaf project', async () => {
                mockTodoistApi.getProject.mockResolvedValue(createMockProject({ id: 'parent' }))
                mockTodoistApi.getProjects.mockResolvedValue({
                    results: [createMockProject({ id: 'unrelated' })],
                    nextCursor: null,
                })

                const result = await fetchObject.execute(
                    { type: 'project', id: 'parent', includeChildren: true },
                    mockTodoistApi,
                )

                expect(result.structuredContent).toMatchObject({ childCount: 0, children: [] })
            })

            it('should short-circuit workspace projects, which nest under folders', async () => {
                mockTodoistApi.getProject.mockResolvedValue(
                    createMockWorkspaceProject({ id: 'workspace-project' }),
                )

                const result = await fetchObject.execute(
                    { type: 'project', id: 'workspace-project', includeChildren: true },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.getProjects).not.toHaveBeenCalled()
                expect(result.structuredContent).toMatchObject({ childCount: 0, children: [] })
            })

            it('should report a failed children lookup without failing the fetch', async () => {
                mockTodoistApi.getProject.mockResolvedValue(createMockProject({ id: 'parent' }))
                mockTodoistApi.getProjects.mockRejectedValue(new Error('Rate limited'))

                const result = await fetchObject.execute(
                    { type: 'project', id: 'parent', includeChildren: true },
                    mockTodoistApi,
                )

                expect(result.structuredContent?.object).toMatchObject({ id: 'parent' })
                expect(childrenOf(result).childrenError).toBe('Rate limited')
                expect(result.textContent).toContain('subProjects=unavailable')
            })
        })

        it.each(['comment', 'section'] as const)(
            'should ignore includeChildren for a %s',
            async (type) => {
                mockTodoistApi.getComment.mockResolvedValue(createMockComment())
                mockTodoistApi.getSection.mockResolvedValue(MOCK_SECTION)

                const result = await fetchObject.execute(
                    { type, id: `${type}123`, includeChildren: true },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.getTasks).not.toHaveBeenCalled()
                expect(mockTodoistApi.getProjects).not.toHaveBeenCalled()
                expect(result.structuredContent).not.toHaveProperty('childCount')
                expect(result.structuredContent).not.toHaveProperty('children')
            },
        )
    })

    describe('error handling', () => {
        it('should format error messages correctly', async () => {
            mockTodoistApi.getTask.mockRejectedValue(new Error('Network timeout'))

            await expect(
                fetchObject.execute({ type: 'task', id: 'task123' }, mockTodoistApi),
            ).rejects.toThrow('Failed to fetch task with id task123: Network timeout')
        })

        it('should handle non-Error objects in catch block', async () => {
            mockTodoistApi.getProject.mockRejectedValue('String error')

            await expect(
                fetchObject.execute({ type: 'project', id: 'project123' }, mockTodoistApi),
            ).rejects.toThrow('Failed to fetch project with id project123: String error')
        })
    })
})
