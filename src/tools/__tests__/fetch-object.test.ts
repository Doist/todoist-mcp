import type { Comment, Section, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockGoal, createMockProject, createMockTask } from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { fetchObject } from '../fetch-object.js'

// Mock the Todoist API
const mockTodoistApi = {
    getTask: vi.fn(),
    getProject: vi.fn(),
    getComment: vi.fn(),
    getSection: vi.fn(),
    getGoal: vi.fn(),
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

    describe('fetching goals', () => {
        it('should fetch a goal by ID and map nullable fields', async () => {
            mockTodoistApi.getGoal.mockResolvedValue(
                createMockGoal({
                    id: 'goal123',
                    name: 'Ship MCP',
                    description: 'Quarterly target',
                    deadline: '2026-12-31',
                    responsibleUid: 'user-42',
                    progress: { totalTaskCount: 4, completedTaskCount: 2, percentage: 50 },
                }),
            )

            const result = await fetchObject.execute(
                { type: 'goal', id: 'goal123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getGoal).toHaveBeenCalledWith('goal123')
            expect(result.textContent).toContain('Found goal: Ship MCP')
            expect(result.textContent).toContain('id=goal123')
            expect(result.textContent).toContain('progress=50%')

            expect(result.structuredContent).toEqual({
                type: 'goal',
                id: 'goal123',
                object: {
                    id: 'goal123',
                    name: 'Ship MCP',
                    ownerType: 'USER',
                    ownerId: expect.any(String),
                    description: 'Quarterly target',
                    deadline: '2026-12-31',
                    responsibleUid: 'user-42',
                    isCompleted: false,
                    progress: { totalTaskCount: 4, completedTaskCount: 2, percentage: 50 },
                },
            })
        })

        it('should omit null fields and missing progress in the mapped output', async () => {
            mockTodoistApi.getGoal.mockResolvedValue(
                createMockGoal({
                    id: 'goal456',
                    name: 'Empty',
                    description: null,
                    deadline: null,
                    responsibleUid: null,
                    progress: undefined,
                }),
            )

            const result = await fetchObject.execute(
                { type: 'goal', id: 'goal456' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('progress=0%')
            const object = result.structuredContent.object as Record<string, unknown>
            expect(object.description).toBeUndefined()
            expect(object.deadline).toBeUndefined()
            expect(object.responsibleUid).toBeUndefined()
        })

        it('should handle goal not found', async () => {
            mockTodoistApi.getGoal.mockRejectedValue(new Error('Goal not found'))

            await expect(
                fetchObject.execute({ type: 'goal', id: 'invalid' }, mockTodoistApi),
            ).rejects.toThrow('Failed to fetch goal with id invalid')
        })
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
