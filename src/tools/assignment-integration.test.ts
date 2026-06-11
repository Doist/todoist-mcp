import type { Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { AssignmentErrorType, assignmentValidator } from '../utils/assignment-validator.js'
import { createMockProject, createMockTask } from '../utils/test-helpers.js'
import { userResolver } from '../utils/user-resolver.js'
import { addTasks } from './add-tasks.js'
import { findProjectCollaborators } from './find-project-collaborators.js'
import { manageAssignments } from './manage-assignments.js'
import { updateTasks } from './update-tasks.js'

// Mock the assignment validator
vi.mock('../utils/assignment-validator.js', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof import('../utils/assignment-validator.js')
    return {
        ...actual,
        assignmentValidator: {
            validateTaskCreationAssignment: vi.fn(),
            validateTaskUpdateAssignment: vi.fn(),
            validateBulkAssignment: vi.fn(),
        },
    }
})

// Mock the user resolver
vi.mock('../utils/user-resolver.js', () => ({
    userResolver: {
        resolveUser: vi.fn(),
        getProjectCollaborators: vi.fn(),
    },
}))

describe('Assignment Integration Tests', () => {
    let mockTodoistApi: Mocked<TodoistApi>

    const mockValidUser = {
        userId: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
        displayName: 'John Doe',
    }

    const mockTask: Task = createMockTask({
        id: 'task-123',
        content: 'Test task',
        projectId: 'project-123',
        url: 'https://todoist.com/showTask?id=task-123',
        addedByUid: 'creator-123',
        addedAt: new Date(),
        updatedAt: new Date(),
        userId: 'creator-123',
        completedAt: null,
    })

    const mockProject = createMockProject({
        id: 'project-123',
        name: 'Test Project',
        color: 'blue',
        isShared: true,
        canAssignTasks: true,
        url: 'https://todoist.com/showProject?id=project-123',
    })

    beforeEach(() => {
        vi.clearAllMocks()

        mockTodoistApi = {
            addTask: vi.fn(),
            updateTask: vi.fn(),
            getTask: vi.fn(),
            getProjects: vi.fn(),
            getProject: vi.fn(),
        } as unknown as Mocked<TodoistApi>

        // Mock assignment validator responses
        const mockAssignmentValidator = vi.mocked(assignmentValidator)
        mockAssignmentValidator.validateTaskCreationAssignment.mockResolvedValue({
            isValid: true,
            resolvedUser: mockValidUser,
        })
        mockAssignmentValidator.validateTaskUpdateAssignment.mockResolvedValue({
            isValid: true,
            resolvedUser: mockValidUser,
        })
        mockAssignmentValidator.validateBulkAssignment.mockResolvedValue([
            { isValid: true, resolvedUser: mockValidUser },
            { isValid: true, resolvedUser: mockValidUser },
            { isValid: true, resolvedUser: mockValidUser },
        ])

        // Mock user resolver
        const mockUserResolver = vi.mocked(userResolver)
        mockUserResolver.resolveUser.mockResolvedValue(mockValidUser)
        mockUserResolver.getProjectCollaborators.mockResolvedValue([
            { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
            { id: 'user-456', name: 'Jane Smith', email: 'jane@example.com' },
        ])

        // Mock API responses
        mockTodoistApi.getProjects.mockResolvedValue({
            results: [mockProject],
            nextCursor: null,
        })
        mockTodoistApi.getProject.mockResolvedValue(mockProject)
        mockTodoistApi.addTask.mockResolvedValue({ ...mockTask, responsibleUid: 'user-123' })
        mockTodoistApi.updateTask.mockResolvedValue({ ...mockTask, responsibleUid: 'user-123' })
        mockTodoistApi.getTask.mockResolvedValue(mockTask)
    })

    describe('Task Creation with Assignment', () => {
        it('should assign task during creation', async () => {
            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'New assigned task',
                            projectId: 'project-123',
                            responsibleUser: 'john@example.com',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: 'New assigned task',
                    projectId: 'project-123',
                    assigneeId: 'user-123', // Should be resolved user ID
                }),
            )

            expect(result.textContent).toContain('Added 1 task')
        })

        it('should validate assignment before creating task', async () => {
            const mockAssignmentValidator = vi.mocked(assignmentValidator)
            mockAssignmentValidator.validateTaskCreationAssignment.mockResolvedValueOnce({
                isValid: false,
                error: {
                    type: AssignmentErrorType.USER_NOT_COLLABORATOR,
                    message: 'User not found in project collaborators',
                    suggestions: ['Use find-project-collaborators to see valid assignees'],
                },
            })

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Invalid assignment task',
                                projectId: 'project-123',
                                responsibleUser: 'nonexistent@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Invalid assignment task": User not found in project collaborators. Use find-project-collaborators to see valid assignees',
            )

            expect(mockTodoistApi.addTask).not.toHaveBeenCalled()
        })

        it('should handle assignment for subtasks', async () => {
            mockTodoistApi.getTask.mockResolvedValueOnce({
                ...mockTask,
                id: 'parent-123',
                projectId: 'project-123',
            })

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Subtask with assignment',
                            parentId: 'parent-123',
                            responsibleUser: 'john@example.com',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: 'Subtask with assignment',
                    parentId: 'parent-123',
                    assigneeId: 'user-123',
                }),
            )
        })
    })

    describe('Task Update with Assignment', () => {
        it('should update task assignment', async () => {
            const result = await updateTasks.execute(
                { tasks: [{ id: 'task-123', responsibleUser: 'jane@example.com' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith(
                'task-123',
                expect.objectContaining({ assigneeId: 'user-123' }),
            )

            expect(result.textContent).toContain('Updated 1 task')
        })

        it('should unassign task when responsibleUser is "unassign"', async () => {
            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: 'task-123',
                            responsibleUser: 'unassign',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith(
                'task-123',
                expect.objectContaining({
                    assigneeId: null,
                }),
            )
        })

        it('should unassign task when responsibleUser is null (backward compatibility)', async () => {
            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: 'task-123',
                            responsibleUser: null as unknown as string,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith(
                'task-123',
                expect.objectContaining({ assigneeId: null }),
            )
        })

        it('should validate assignment changes', async () => {
            const mockAssignmentValidator = vi.mocked(assignmentValidator)
            mockAssignmentValidator.validateTaskUpdateAssignment.mockResolvedValueOnce({
                isValid: false,
                error: {
                    type: AssignmentErrorType.USER_NOT_COLLABORATOR,
                    message: 'User cannot be assigned to this project',
                },
            })

            const result = await updateTasks.execute(
                { tasks: [{ id: 'task-123', responsibleUser: 'invalid@example.com' }] },
                mockTodoistApi,
            )

            // Invalid assignment is reported per-item in `failures`, not thrown.
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(0)
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('task-123')
            expect(structuredContent.failures[0]?.error).toContain(
                'Task task-123: User cannot be assigned to this project',
            )
            expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()
        })
    })

    describe('Bulk Assignment Operations', () => {
        beforeEach(() => {
            mockTodoistApi.getTask
                .mockResolvedValueOnce({ ...mockTask, id: 'task-1' })
                .mockResolvedValueOnce({ ...mockTask, id: 'task-2' })
                .mockResolvedValueOnce({ ...mockTask, id: 'task-3' })
        })

        it('should perform bulk assignment', async () => {
            const result = await manageAssignments.execute(
                {
                    operation: 'assign',
                    taskIds: ['task-1', 'task-2', 'task-3'],
                    responsibleUser: 'john@example.com',
                    dryRun: false,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-1', {
                assigneeId: 'user-123',
            })
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-2', {
                assigneeId: 'user-123',
            })
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-3', {
                assigneeId: 'user-123',
            })

            expect(result.textContent).toContain('3 tasks were successfully assigned')
        })

        it('should perform bulk unassignment', async () => {
            const result = await manageAssignments.execute(
                {
                    operation: 'unassign',
                    taskIds: ['task-1', 'task-2'],
                    dryRun: false,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-1', {
                assigneeId: null,
            })
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-2', {
                assigneeId: null,
            })

            expect(result.textContent).toContain('2 tasks were successfully unassigned')
        })

        it('should handle dry-run mode', async () => {
            // Mock validation for 2 tasks
            const mockAssignmentValidator = vi.mocked(assignmentValidator)
            mockAssignmentValidator.validateBulkAssignment.mockResolvedValueOnce([
                { isValid: true, resolvedUser: mockValidUser },
                { isValid: true, resolvedUser: mockValidUser },
            ])

            const result = await manageAssignments.execute(
                {
                    operation: 'assign',
                    taskIds: ['task-1', 'task-2'],
                    responsibleUser: 'john@example.com',
                    dryRun: true,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()
            expect(result.textContent).toContain('Dry Run: Bulk assign operation')
            expect(result.textContent).toContain('2 tasks would be successfully assigned')
        })

        it('should handle mixed success and failure results', async () => {
            // Mock validation for 3 tasks - 2 valid, 1 invalid
            const mockAssignmentValidator = vi.mocked(assignmentValidator)
            mockAssignmentValidator.validateBulkAssignment.mockResolvedValueOnce([
                { isValid: true, resolvedUser: mockValidUser },
                {
                    isValid: false,
                    error: { type: AssignmentErrorType.PERMISSION_DENIED, message: 'API Error' },
                },
                { isValid: true, resolvedUser: mockValidUser },
            ])

            mockTodoistApi.updateTask
                .mockResolvedValueOnce({ ...mockTask, id: 'task-1' })
                .mockResolvedValueOnce({ ...mockTask, id: 'task-3' })

            const result = await manageAssignments.execute(
                {
                    operation: 'assign',
                    taskIds: ['task-1', 'task-2', 'task-3'],
                    responsibleUser: 'john@example.com',
                    dryRun: false,
                },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('2 tasks were successfully assigned')
            expect(result.textContent).toContain('1 task failed')
            expect(result.textContent).toContain('API Error')
        })
    })

    describe('Project Collaborators Discovery', () => {
        it('should find project collaborators', async () => {
            const result = await findProjectCollaborators.execute(
                {
                    projectId: 'project-123',
                },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('Project collaborators')
            expect(result.textContent).toContain('John Doe (john@example.com)')
            expect(result.textContent).toContain('Jane Smith (jane@example.com)')
            expect(result.structuredContent.collaborators).toHaveLength(2)
        })

        it('should filter collaborators by search term', async () => {
            const result = await findProjectCollaborators.execute(
                {
                    projectId: 'project-123',
                    searchTerm: 'John',
                },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('matching "John"')
        })

        it('should handle non-shared projects', async () => {
            mockTodoistApi.getProject.mockResolvedValueOnce({ ...mockProject, isShared: false })

            const result = await findProjectCollaborators.execute(
                { projectId: 'project-123' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('is not shared and has no collaborators')
            expect(result.structuredContent.collaborators).toEqual([]) // Empty arrays are removed
        })

        it('should handle project not found', async () => {
            mockTodoistApi.getProject.mockRejectedValueOnce(new Error('Project not found'))

            await expect(
                findProjectCollaborators.execute(
                    { projectId: 'nonexistent-project' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Failed to access project "nonexistent-project"')
        })
    })

    describe('Error Handling and Edge Cases', () => {
        it('should handle assignment validation errors gracefully', async () => {
            const mockAssignmentValidator = vi.mocked(assignmentValidator)
            mockAssignmentValidator.validateTaskCreationAssignment.mockResolvedValueOnce({
                isValid: false,
                error: {
                    type: AssignmentErrorType.PROJECT_NOT_SHARED,
                    message: 'Project not shared',
                    suggestions: ['Share the project to enable assignments'],
                },
            })

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Task in unshared project',
                                projectId: 'project-123',
                                responsibleUser: 'john@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Task in unshared project": Project not shared. Share the project to enable assignments',
            )
        })

        it('should handle inbox assignment restriction', async () => {
            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Inbox task with assignment',
                                responsibleUser: 'john@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Inbox task with assignment": Cannot assign tasks without specifying project context. Please specify a projectId, sectionId, or parentId.',
            )
        })

        it('should handle parent task not found', async () => {
            mockTodoistApi.getTask.mockRejectedValueOnce(new Error('Task not found'))

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Subtask with bad parent',
                                parentId: 'nonexistent-parent',
                                responsibleUser: 'john@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Subtask with bad parent": Parent task "nonexistent-parent" not found',
            )
        })

        it('should throw when all task fetches fail', async () => {
            mockTodoistApi.getTask.mockReset()
            mockTodoistApi.getTask.mockRejectedValue(new Error('Not found'))

            await expect(
                manageAssignments.execute(
                    {
                        operation: 'assign',
                        taskIds: ['bad-1', 'bad-2'],
                        responsibleUser: 'john@example.com',
                        dryRun: false,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('All 2 task(s) failed')
        })

        it('should throw when all assign validations fail', async () => {
            mockTodoistApi.getTask.mockReset()
            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const mockAssignmentValidator = vi.mocked(assignmentValidator)
            mockAssignmentValidator.validateBulkAssignment.mockResolvedValueOnce([
                {
                    isValid: false,
                    error: {
                        type: AssignmentErrorType.PROJECT_NOT_SHARED,
                        message: 'Project is not shared',
                    },
                },
            ])

            await expect(
                manageAssignments.execute(
                    {
                        operation: 'assign',
                        taskIds: ['task-123'],
                        responsibleUser: 'john@example.com',
                        dryRun: false,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('All 1 assign operation(s) failed')
        })

        it('should throw when all unassign operations fail', async () => {
            mockTodoistApi.getTask.mockReset()
            mockTodoistApi.getTask.mockResolvedValue(mockTask)
            mockTodoistApi.updateTask.mockRejectedValue(new Error('API error'))

            await expect(
                manageAssignments.execute(
                    {
                        operation: 'unassign',
                        taskIds: ['task-123'],
                        dryRun: false,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('All 1 unassign operation(s) failed')
        })

        it('should require responsibleUser for assign operations', async () => {
            await expect(
                manageAssignments.execute(
                    {
                        operation: 'assign',
                        taskIds: ['task-1'],
                        dryRun: false,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('assign operation requires responsibleUser parameter')
        })

        it('should require responsibleUser for reassign operations', async () => {
            await expect(
                manageAssignments.execute(
                    {
                        operation: 'reassign',
                        taskIds: ['task-1'],
                        dryRun: false,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('reassign operation requires responsibleUser parameter')
        })
    })

    describe('End-to-End Assignment Workflows', () => {
        it('should support complete assignment lifecycle', async () => {
            // 1. Create assigned task
            const createResult = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task for lifecycle test',
                            projectId: 'project-123',
                            responsibleUser: 'john@example.com',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(createResult.textContent).toContain('Added 1 task')

            // 2. Update assignment
            const updateResult = await updateTasks.execute(
                { tasks: [{ id: 'task-123', responsibleUser: 'jane@example.com' }] },
                mockTodoistApi,
            )

            expect(updateResult.textContent).toContain('Updated 1 task')

            // 3. Unassign task
            const unassignResult = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: 'task-123',
                            responsibleUser: null as unknown as string,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(unassignResult.textContent).toContain('Updated 1 task')
        })
    })
})
