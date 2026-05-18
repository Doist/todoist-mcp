import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { createMockProject, createMockWorkspaceProject } from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { deleteObject } from '../delete-object.js'

// Mock the Todoist API
const mockTodoistApi = {
    getProject: vi.fn(),
    deleteProject: vi.fn(),
    deleteSection: vi.fn(),
    deleteTask: vi.fn(),
    deleteComment: vi.fn(),
    deleteLabel: vi.fn(),
    deleteGoal: vi.fn(),
    deleteReminder: vi.fn(),
    deleteLocationReminder: vi.fn(),
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { DELETE_OBJECT } = ToolNames

describe(`${DELETE_OBJECT} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('deleting projects', () => {
        it('should delete a project by ID', async () => {
            mockTodoistApi.getProject.mockResolvedValue(createMockProject())
            mockTodoistApi.deleteProject.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'project', id: '6cfCcrrCFg2xP94Q' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteProject).toHaveBeenCalledWith('6cfCcrrCFg2xP94Q')
            expect(mockTodoistApi.deleteSection).not.toHaveBeenCalled()
            expect(mockTodoistApi.deleteTask).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toContain('Deleted project: id=6cfCcrrCFg2xP94Q')
            expect(result.structuredContent).toEqual({
                deletedEntity: {
                    type: 'project',
                    id: '6cfCcrrCFg2xP94Q',
                },
                success: true,
            })
        })

        it('should propagate project deletion errors', async () => {
            mockTodoistApi.getProject.mockResolvedValue(createMockProject())
            const apiError = new Error('API Error: Cannot delete project with tasks')
            mockTodoistApi.deleteProject.mockRejectedValue(apiError)

            await expect(
                deleteObject.execute({ type: 'project', id: 'project-with-tasks' }, mockTodoistApi),
            ).rejects.toThrow('API Error: Cannot delete project with tasks')
        })

        it('should prevent deletion of unarchived workspace projects', async () => {
            mockTodoistApi.getProject.mockResolvedValue(
                createMockWorkspaceProject({ name: 'Team Project' }),
            )

            await expect(
                deleteObject.execute({ type: 'project', id: 'workspace-proj' }, mockTodoistApi),
            ).rejects.toThrow(
                'Workspace project "Team Project" must be archived before it can be deleted',
            )
            expect(mockTodoistApi.deleteProject).not.toHaveBeenCalled()
        })

        it('should allow deletion of archived workspace projects', async () => {
            mockTodoistApi.getProject.mockResolvedValue(
                createMockWorkspaceProject({ isArchived: true }),
            )
            mockTodoistApi.deleteProject.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'project', id: 'archived-ws-proj' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteProject).toHaveBeenCalledWith('archived-ws-proj')
            expect(result.structuredContent.success).toBe(true)
        })
    })

    describe('deleting sections', () => {
        it('should delete a section by ID', async () => {
            mockTodoistApi.deleteSection.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'section', id: 'section-123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteSection).toHaveBeenCalledWith('section-123')
            expect(mockTodoistApi.deleteProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.deleteTask).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Deleted section: id=section-123')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'section', id: 'section-123' },
                success: true,
            })
        })

        it('should propagate section deletion errors', async () => {
            const apiError = new Error('API Error: Section not found')
            mockTodoistApi.deleteSection.mockRejectedValue(apiError)

            await expect(
                deleteObject.execute(
                    { type: 'section', id: 'non-existent-section' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Section not found')
        })
    })

    describe('deleting tasks', () => {
        it('should delete a task by ID', async () => {
            mockTodoistApi.deleteTask.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'task', id: '8485093748' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteTask).toHaveBeenCalledWith('8485093748')
            expect(mockTodoistApi.deleteProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.deleteSection).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Deleted task: id=8485093748')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'task', id: '8485093748' },
                success: true,
            })
        })

        it('should propagate task deletion errors', async () => {
            const apiError = new Error('API Error: Task not found')
            mockTodoistApi.deleteTask.mockRejectedValue(apiError)

            await expect(
                deleteObject.execute({ type: 'task', id: 'non-existent-task' }, mockTodoistApi),
            ).rejects.toThrow('API Error: Task not found')
        })

        it('should handle permission errors', async () => {
            const apiError = new Error('API Error: Insufficient permissions to delete task')
            mockTodoistApi.deleteTask.mockRejectedValue(apiError)

            await expect(
                deleteObject.execute({ type: 'task', id: 'restricted-task' }, mockTodoistApi),
            ).rejects.toThrow('API Error: Insufficient permissions to delete task')
        })
    })

    describe('deleting comments', () => {
        it('should delete a comment by ID', async () => {
            mockTodoistApi.deleteComment.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'comment', id: 'comment-456' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteComment).toHaveBeenCalledWith('comment-456')
            expect(mockTodoistApi.deleteProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.deleteTask).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Deleted comment: id=comment-456')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'comment', id: 'comment-456' },
                success: true,
            })
        })

        it('should propagate comment deletion errors', async () => {
            mockTodoistApi.deleteComment.mockRejectedValue(
                new Error('API Error: Comment not found'),
            )

            await expect(
                deleteObject.execute(
                    { type: 'comment', id: 'non-existent-comment' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Comment not found')
        })
    })

    describe('deleting labels', () => {
        it('should delete a label by ID', async () => {
            mockTodoistApi.deleteLabel.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'label', id: 'label-123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteLabel).toHaveBeenCalledWith('label-123')
            expect(mockTodoistApi.deleteProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.deleteTask).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Deleted label: id=label-123')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'label', id: 'label-123' },
                success: true,
            })
        })

        it('should propagate label deletion errors', async () => {
            mockTodoistApi.deleteLabel.mockRejectedValue(new Error('API Error: Label not found'))

            await expect(
                deleteObject.execute({ type: 'label', id: 'non-existent-label' }, mockTodoistApi),
            ).rejects.toThrow('API Error: Label not found')
        })
    })

    describe('deleting filters', () => {
        it('should delete a filter by ID using sync API', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                syncStatus: { 'some-uuid': 'ok' },
            })

            const result = await deleteObject.execute(
                { type: 'filter', id: 'filter-123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledOnce()
            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands).toHaveLength(1)
            expect(syncCall?.commands?.[0]?.type).toBe('filter_delete')
            expect(syncCall?.commands?.[0]?.args).toEqual({ id: 'filter-123' })

            const textContent = result.textContent
            expect(textContent).toContain('Deleted filter: id=filter-123')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'filter', id: 'filter-123' },
                success: true,
            })
        })

        it('should propagate filter deletion errors', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error('API Error: Filter not found'))

            await expect(
                deleteObject.execute({ type: 'filter', id: 'non-existent-filter' }, mockTodoistApi),
            ).rejects.toThrow('API Error: Filter not found')
        })
    })

    describe('deleting goals', () => {
        it('should delete a goal by ID', async () => {
            mockTodoistApi.deleteGoal.mockResolvedValue(true as never)

            const result = await deleteObject.execute(
                { type: 'goal', id: 'goal-123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteGoal).toHaveBeenCalledWith('goal-123')
            expect(mockTodoistApi.deleteProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.deleteTask).not.toHaveBeenCalled()

            expect(result.textContent).toContain('Deleted goal: id=goal-123')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'goal', id: 'goal-123' },
                success: true,
            })
        })

        it('should propagate goal deletion errors', async () => {
            mockTodoistApi.deleteGoal.mockRejectedValue(new Error('API Error: Goal not found'))

            await expect(
                deleteObject.execute({ type: 'goal', id: 'non-existent-goal' }, mockTodoistApi),
            ).rejects.toThrow('API Error: Goal not found')
        })
    })

    describe('deleting reminders', () => {
        it('should delete a time-based reminder by ID', async () => {
            mockTodoistApi.deleteReminder.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'reminder', id: 'reminder-123' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteReminder).toHaveBeenCalledWith('reminder-123')
            expect(result.textContent).toContain('Deleted reminder: id=reminder-123')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'reminder', id: 'reminder-123' },
                success: true,
            })
        })

        it('should propagate reminder deletion errors', async () => {
            mockTodoistApi.deleteReminder.mockRejectedValue(
                new Error('API Error: Reminder not found'),
            )

            await expect(
                deleteObject.execute(
                    { type: 'reminder', id: 'non-existent-reminder' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Reminder not found')
        })
    })

    describe('deleting location reminders', () => {
        it('should delete a location reminder by ID', async () => {
            mockTodoistApi.deleteLocationReminder.mockResolvedValue(true)

            const result = await deleteObject.execute(
                { type: 'location_reminder', id: 'loc-reminder-456' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.deleteLocationReminder).toHaveBeenCalledWith('loc-reminder-456')
            expect(result.textContent).toContain('Deleted location_reminder: id=loc-reminder-456')
            expect(result.structuredContent).toEqual({
                deletedEntity: { type: 'location_reminder', id: 'loc-reminder-456' },
                success: true,
            })
        })

        it('should propagate location reminder deletion errors', async () => {
            mockTodoistApi.deleteLocationReminder.mockRejectedValue(
                new Error('API Error: Location reminder not found'),
            )

            await expect(
                deleteObject.execute(
                    { type: 'location_reminder', id: 'non-existent' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Location reminder not found')
        })
    })

    describe('type validation', () => {
        it('should handle all supported entity types', async () => {
            mockTodoistApi.getProject.mockResolvedValue(createMockProject())
            mockTodoistApi.deleteProject.mockResolvedValue(true)
            mockTodoistApi.deleteSection.mockResolvedValue(true)
            mockTodoistApi.deleteTask.mockResolvedValue(true)
            mockTodoistApi.deleteComment.mockResolvedValue(true)
            mockTodoistApi.deleteLabel.mockResolvedValue(true)
            mockTodoistApi.deleteGoal.mockResolvedValue(true as never)
            mockTodoistApi.sync.mockResolvedValue({})

            await deleteObject.execute({ type: 'project', id: 'proj-1' }, mockTodoistApi)
            expect(mockTodoistApi.deleteProject).toHaveBeenCalledWith('proj-1')

            await deleteObject.execute({ type: 'section', id: 'sect-1' }, mockTodoistApi)
            expect(mockTodoistApi.deleteSection).toHaveBeenCalledWith('sect-1')

            await deleteObject.execute({ type: 'task', id: 'task-1' }, mockTodoistApi)
            expect(mockTodoistApi.deleteTask).toHaveBeenCalledWith('task-1')

            await deleteObject.execute({ type: 'comment', id: 'comment-1' }, mockTodoistApi)
            expect(mockTodoistApi.deleteComment).toHaveBeenCalledWith('comment-1')

            await deleteObject.execute({ type: 'label', id: 'label-1' }, mockTodoistApi)
            expect(mockTodoistApi.deleteLabel).toHaveBeenCalledWith('label-1')

            await deleteObject.execute({ type: 'goal', id: 'goal-1' }, mockTodoistApi)
            expect(mockTodoistApi.deleteGoal).toHaveBeenCalledWith('goal-1')

            await deleteObject.execute({ type: 'filter', id: 'filter-1' }, mockTodoistApi)
            expect(mockTodoistApi.sync).toHaveBeenCalled()

            expect(mockTodoistApi.deleteProject).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.deleteSection).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.deleteTask).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.deleteComment).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.deleteLabel).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.deleteGoal).toHaveBeenCalledTimes(1)
        })
    })
})
