import type { Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { convertPriorityToNumber } from '../../utils/priorities.js'
import { createMockTask, createMockUser, TEST_IDS } from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { updateTasks } from '../update-tasks.js'

// Mock the Todoist API
const mockTodoistApi = {
    updateTask: vi.fn(),
    moveTask: vi.fn(),
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_TASKS } = ToolNames

describe(`${UPDATE_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getUser.mockResolvedValue(createMockUser())
    })

    describe('updating task properties', () => {
        it('should update task content and description', async () => {
            // Mock API response extracted from recordings (Task type)
            const mockApiResponse: Task = createMockTask({
                id: '8485093748',
                content: 'Updated task content',
                description: 'Updated task description',
                url: 'https://todoist.com/showTask?id=8485093748',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093748',
                            content: 'Updated task content',
                            description: 'Updated task description',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093748', {
                content: 'Updated task content',
                description: 'Updated task description',
            })

            // Verify result matches expected structure with text and structured content
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    tasks: expect.arrayContaining([expect.objectContaining({ id: '8485093748' })]),
                }),
            )
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should update all tasks when multiple tasks are provided', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093748',
                content: 'Updated task content',
                description: 'Updated task description',
                url: 'https://todoist.com/showTask?id=8485093748',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093748',
                            content: 'Updated task content',
                            description: 'Updated task description',
                        },
                        {
                            id: '8485093749',
                            content: 'Updated task content',
                            description: 'Updated task description',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093748', {
                content: 'Updated task content',
                description: 'Updated task description',
            })
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093749', {
                content: 'Updated task content',
                description: 'Updated task description',
            })

            // Verify result matches expected structure with text and structured content
            expect(result.textContent).toContain('Updated 2 tasks')
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    totalCount: 2,
                    tasks: expect.any(Array),
                }),
            )
            expect(structuredContent.tasks).toHaveLength(2)
        })

        it('should update task priority and due date', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093749',
                content: 'Original task content',
                labels: ['urgent'],
                priority: 'p2',
                url: 'https://todoist.com/showTask?id=8485093749',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
                due: {
                    date: '2025-08-20',
                    isRecurring: false,
                    lang: 'en',
                    string: 'Aug 20',
                    timezone: null,
                },
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093749',
                            priority: 'p3',
                            dueString: 'Aug 20',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093749', {
                priority: convertPriorityToNumber('p3'),
                dueString: 'Aug 20',
            })

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should move task to different project', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093750',
                content: 'Task to move',
                projectId: 'new-project-id',
                url: 'https://todoist.com/showTask?id=8485093750',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.moveTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093750',
                            projectId: 'new-project-id',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('8485093750', {
                projectId: 'new-project-id',
            })
            expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should update task parent (create subtask relationship)', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093751',
                content: 'Subtask content',
                parentId: 'parent-task-123',
                url: 'https://todoist.com/showTask?id=8485093751',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.moveTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093751',
                            parentId: 'parent-task-123',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('8485093751', {
                parentId: 'parent-task-123',
            })
            expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should move task and update properties at once', async () => {
            const movedTask = createMockTask({
                id: '8485093752',
                content: 'Task to move',
                projectId: 'different-project-id',
            })

            const updatedTask = createMockTask({
                id: '8485093752',
                content: 'Completely updated task',
                description: 'New description with details',
                priority: 'p1',
                projectId: 'different-project-id',
                url: 'https://todoist.com/showTask?id=8485093752',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
                due: {
                    date: '2025-08-25',
                    isRecurring: true,
                    lang: 'en',
                    string: 'every Friday',
                    timezone: null,
                },
            })

            mockTodoistApi.moveTask.mockResolvedValue(movedTask)
            mockTodoistApi.updateTask.mockResolvedValue(updatedTask)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093752',
                            content: 'Completely updated task',
                            description: 'New description with details',
                            priority: 'p4',
                            dueString: 'every Friday',
                            projectId: 'different-project-id',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Should call moveTask first for the projectId
            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('8485093752', {
                projectId: 'different-project-id',
            })

            // Then call updateTask for the other properties
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093752', {
                content: 'Completely updated task',
                description: 'New description with details',
                priority: convertPriorityToNumber('p4'),
                dueString: 'every Friday',
            })

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    tasks: expect.arrayContaining([expect.objectContaining({ id: '8485093752' })]),
                }),
            )
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should update task duration', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093753',
                content: 'Task with updated duration',
                duration: { amount: 150, unit: 'minute' },
                url: 'https://todoist.com/showTask?id=8485093753',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093753',
                            duration: '2h30m',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093753', {
                duration: 150,
                durationUnit: 'minute',
            })

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    tasks: expect.arrayContaining([expect.objectContaining({ id: '8485093753' })]),
                }),
            )
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should handle various duration formats', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093754',
                content: 'Test task',
                duration: { amount: 120, unit: 'minute' },
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            // Test different duration formats
            const testCases = [
                { input: '2h', expectedMinutes: 120 },
                { input: '90m', expectedMinutes: 90 },
                { input: '1.5h', expectedMinutes: 90 },
                { input: ' 2h 30m ', expectedMinutes: 150 },
                { input: '2H30M', expectedMinutes: 150 },
            ]

            for (const testCase of testCases) {
                mockTodoistApi.updateTask.mockClear()

                await updateTasks.execute(
                    {
                        tasks: [
                            {
                                id: '8485093754',
                                duration: testCase.input,
                            },
                        ],
                    },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.updateTask).toHaveBeenCalledWith(
                    '8485093754',
                    expect.objectContaining({
                        duration: testCase.expectedMinutes,
                        durationUnit: 'minute',
                    }),
                )
            }
        })

        it('should update task with duration and move at once', async () => {
            const movedTask = createMockTask({
                id: '8485093755',
                content: 'Task to move and update',
                projectId: 'new-project-id',
            })

            const updatedTask = createMockTask({
                id: '8485093755',
                content: 'Updated task with duration',
                duration: { amount: 120, unit: 'minute' },
                projectId: 'new-project-id',
            })

            mockTodoistApi.moveTask.mockResolvedValue(movedTask)
            mockTodoistApi.updateTask.mockResolvedValue(updatedTask)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093755',
                            content: 'Updated task with duration',
                            duration: '2h',
                            projectId: 'new-project-id',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Should call moveTask first
            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('8485093755', {
                projectId: 'new-project-id',
            })

            // Then call updateTask with duration
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093755', {
                content: 'Updated task with duration',
                duration: 120,
                durationUnit: 'minute',
            })

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    tasks: expect.arrayContaining([expect.objectContaining({ id: '8485093755' })]),
                }),
            )
            expect(structuredContent.tasks).toHaveLength(1)
        })
    })

    describe('updating deadlines', () => {
        it('should update task deadline', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093760',
                content: 'Task with deadline',
                deadline: {
                    date: '2025-12-31',
                    lang: 'en',
                },
                url: 'https://todoist.com/showTask?id=8485093760',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093760',
                            deadlineDate: '2025-12-31',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called with deadline
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093760', {
                deadlineDate: '2025-12-31',
            })

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    tasks: expect.arrayContaining([
                        expect.objectContaining({
                            id: '8485093760',
                            deadlineDate: '2025-12-31',
                        }),
                    ]),
                }),
            )
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should remove task deadline with "remove" string', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093761',
                content: 'Task without deadline',
                deadline: null,
                url: 'https://todoist.com/showTask?id=8485093761',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093761',
                            deadlineDate: 'remove',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called to remove deadline (converts "remove" to null)
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093761', {
                deadlineDate: null,
            })

            // Verify result structure
            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(1)
        })

        it('should remove task deadline with "no date" string', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093765',
                content: 'Task without deadline',
                deadline: null,
                url: 'https://todoist.com/showTask?id=8485093765',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093765',
                            deadlineDate: 'no date',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093765', {
                deadlineDate: null,
            })
        })
    })

    describe('updating due dates', () => {
        it('should remove task due date with "remove" string', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093762',
                content: 'Task without due date',
                due: null,
                url: 'https://todoist.com/showTask?id=8485093762',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093762',
                            dueString: 'remove',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093762', {
                dueString: 'no date',
            })

            expect(result.textContent).toContain('Updated 1 task')
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(1)
            expect(structuredContent.tasks).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: '8485093762',
                        dueDate: undefined,
                        recurring: false,
                    }),
                ]),
            )
        })

        it('should remove task due date with null for backward compatibility', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093763',
                content: 'Task without due date',
                due: null,
                url: 'https://todoist.com/showTask?id=8485093763',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093763',
                            dueString: null as unknown as string,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093763', {
                dueString: 'no date',
            })
        })

        it('should remove task due date with "no date" string', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093764',
                content: 'Task without due date',
                due: null,
                url: 'https://todoist.com/showTask?id=8485093764',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093764',
                            dueString: 'no date',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093764', {
                dueString: 'no date',
            })
        })
    })

    describe('updating labels', () => {
        it('should update task labels', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093750',
                content: 'Task with updated labels',
                labels: ['work', 'important'],
                url: 'https://todoist.com/showTask?id=8485093750',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093750',
                            labels: ['work', 'important'],
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093750', {
                labels: ['work', 'important'],
            })

            // Verify structured content includes updated labels
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(1)
            expect(structuredContent.tasks).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        labels: ['work', 'important'],
                    }),
                ]),
            )
        })

        it('should clear task labels with empty array', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093751',
                content: 'Task with cleared labels',
                labels: [],
                url: 'https://todoist.com/showTask?id=8485093751',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093751',
                            labels: [],
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093751', {
                labels: [],
            })
        })

        it('should update task with labels along with other fields', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093752',
                content: 'Updated content',
                labels: ['personal', 'todo'],
                priority: 'p2',
                url: 'https://todoist.com/showTask?id=8485093752',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.updateTask.mockResolvedValue(mockApiResponse)

            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: '8485093752',
                            content: 'Updated content',
                            labels: ['personal', 'todo'],
                            priority: 'p2',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('8485093752', {
                content: 'Updated content',
                labels: ['personal', 'todo'],
                priority: convertPriorityToNumber('p2'),
            })
        })
    })

    describe('error handling', () => {
        it('should throw error for invalid duration format', async () => {
            await expect(
                updateTasks.execute(
                    {
                        tasks: [
                            {
                                id: '8485093756',
                                duration: 'invalid',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Task 8485093756: Invalid duration format "invalid"')
        })

        it('should throw error for duration exceeding 24 hours', async () => {
            await expect(
                updateTasks.execute(
                    {
                        tasks: [
                            {
                                id: '8485093757',
                                duration: '25h',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task 8485093757: Invalid duration format "25h": Duration cannot exceed 24 hours (1440 minutes)',
            )
        })
        it('should throw error when multiple move parameters are provided', async () => {
            await expect(
                updateTasks.execute(
                    {
                        tasks: [
                            {
                                id: '8485093748',
                                projectId: 'new-project',
                                sectionId: 'new-section',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Only one of projectId, sectionId, or parentId can be specified at a time. ' +
                    'The Todoist API requires exactly one destination for move operations.',
            )
        })

        it('should throw error when all three move parameters are provided', async () => {
            await expect(
                updateTasks.execute(
                    {
                        tasks: [
                            {
                                id: '8485093748',
                                projectId: 'p1',
                                sectionId: 's1',
                                parentId: 't1',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Only one of projectId, sectionId, or parentId can be specified at a time',
            )
        })

        it.each([
            {
                error: 'API Error: Task not found',
                params: { id: 'non-existent-task', content: 'Updated content' },
            },
            {
                error: 'API Error: Invalid priority value',
                params: { id: '8485093748', content: 'Test task' },
            },
        ])('should propagate $error', async ({ error, params }) => {
            mockTodoistApi.updateTask.mockRejectedValue(new Error(error))
            await expect(
                updateTasks.execute(
                    {
                        tasks: [params],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(error)
        })
    })

    describe('task organisation', () => {
        describe('organizing multiple tasks', () => {
            it('should move multiple tasks to the same destination', async () => {
                const sectionId = '6cfPqr9xgvmgW6J0'
                const mockResponses = [
                    createMockTask({ id: '6cPuJm79x4QhMwR4', content: 'First task', sectionId }),
                    createMockTask({ id: '6cPHJj2MV4HMj92W', content: 'Second task', sectionId }),
                ]

                // Each task should be moved individually to avoid bulk operation issues
                mockTodoistApi.moveTask
                    .mockResolvedValueOnce(mockResponses[0] as Task)
                    .mockResolvedValueOnce(mockResponses[1] as Task)

                const result = await updateTasks.execute(
                    {
                        tasks: [
                            { id: '6cPHJm59x4WhMwR4', sectionId },
                            { id: '6cPHJj2MV4HMj92W', sectionId },
                        ],
                    },
                    mockTodoistApi,
                )

                // Should call moveTask twice, once for each task individually
                expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(2)
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(1, '6cPHJm59x4WhMwR4', {
                    sectionId,
                })
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(2, '6cPHJj2MV4HMj92W', {
                    sectionId,
                })
                expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

                // Verify result structure
                expect(result.textContent).toContain('Updated 2 tasks')
                const { structuredContent } = result
                expect(structuredContent.tasks).toHaveLength(2)
                expect(structuredContent.totalCount).toBe(2)
            })

            it('should move multiple tasks with different destinations', async () => {
                const { TASK_1, TASK_2, TASK_3 } = TEST_IDS
                const mockResponses = [
                    createMockTask({ id: TASK_1, content: 'Task 1', projectId: 'new-project-id' }),
                    createMockTask({ id: TASK_2, content: 'Task 2', sectionId: 'new-section-id' }),
                    createMockTask({ id: TASK_3, content: 'Task 3', parentId: 'parent-task-123' }),
                ]

                // Each task should be moved individually
                mockTodoistApi.moveTask
                    .mockResolvedValueOnce(mockResponses[0] as Task)
                    .mockResolvedValueOnce(mockResponses[1] as Task)
                    .mockResolvedValueOnce(mockResponses[2] as Task)

                const result = await updateTasks.execute(
                    {
                        tasks: [
                            { id: '8485093748', projectId: 'new-project-id' },
                            { id: '8485093749', sectionId: 'new-section-id' },
                            { id: '8485093750', parentId: 'parent-task-123' },
                        ],
                    },
                    mockTodoistApi,
                )

                // Verify API was called correctly - 3 individual move calls
                expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(3)
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(1, '8485093748', {
                    projectId: 'new-project-id',
                })
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(2, '8485093749', {
                    sectionId: 'new-section-id',
                })
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(3, '8485093750', {
                    parentId: 'parent-task-123',
                })
                expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

                // Verify results are returned in the correct order
                expect(result.textContent).toContain('Updated 3 tasks')
                const { structuredContent } = result
                expect(structuredContent.tasks).toHaveLength(3)
                expect(structuredContent.totalCount).toBe(3)
            })

            it('should handle single task organization', async () => {
                const mockTaskResponse: Task = createMockTask({
                    id: '8485093751',
                    content: 'Single task update',
                    sectionId: 'target-section',
                    url: 'https://todoist.com/showTask?id=8485093751',
                    addedAt: new Date('2025-08-13T22:09:59.123456Z'),
                })

                mockTodoistApi.moveTask.mockResolvedValue(mockTaskResponse)

                const result = await updateTasks.execute(
                    { tasks: [{ id: '8485093751', sectionId: 'target-section' }] },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(1)
                expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('8485093751', {
                    sectionId: 'target-section',
                })
                expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

                // Verify result structure
                expect(result.textContent).toContain('Updated 1 task')
                const { structuredContent } = result
                expect(structuredContent).toEqual(
                    expect.objectContaining({
                        tasks: expect.arrayContaining([
                            expect.objectContaining({ id: '8485093751' }),
                        ]),
                    }),
                )
                expect(structuredContent.tasks).toHaveLength(1)
            })

            it('should handle complex reorganization scenario', async () => {
                // Simulate moving tasks to different destinations (one move param per task)
                const mockResponses: Task[] = [
                    createMockTask({
                        id: 'task-1',
                        content: 'Task moved to new project',
                        projectId: 'project-new',
                        url: 'https://todoist.com/showTask?id=task-1',
                        addedAt: new Date('2025-08-13T22:10:00.123456Z'),
                    }),
                    createMockTask({
                        id: 'task-2',
                        content: 'Task made into subtask',
                        parentId: 'task-1',
                        url: 'https://todoist.com/showTask?id=task-2',
                        addedAt: new Date('2025-08-13T22:10:01.123456Z'),
                    }),
                    createMockTask({
                        id: 'task-3',
                        content: 'Task moved to section',
                        sectionId: 'section-new',
                        url: 'https://todoist.com/showTask?id=task-3',
                        addedAt: new Date('2025-08-13T22:10:02.123456Z'),
                    }),
                ]

                // Each task should be moved individually
                mockTodoistApi.moveTask
                    .mockResolvedValueOnce(mockResponses[0] as Task)
                    .mockResolvedValueOnce(mockResponses[1] as Task)
                    .mockResolvedValueOnce(mockResponses[2] as Task)

                const result = await updateTasks.execute(
                    {
                        tasks: [
                            { id: 'task-1', projectId: 'project-new' },
                            { id: 'task-2', parentId: 'task-1' },
                            { id: 'task-3', sectionId: 'section-new' },
                        ],
                    },
                    mockTodoistApi,
                )

                // Verify API was called correctly - 3 individual move calls
                expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(3)
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(1, 'task-1', {
                    projectId: 'project-new',
                })
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(2, 'task-2', {
                    parentId: 'task-1',
                })
                expect(mockTodoistApi.moveTask).toHaveBeenNthCalledWith(3, 'task-3', {
                    sectionId: 'section-new',
                })
                expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

                // Verify result structure
                expect(result.textContent).toContain('Updated 3 tasks')
                const { structuredContent } = result
                expect(structuredContent.tasks).toHaveLength(3)
                expect(structuredContent.totalCount).toBe(3)
            })
        })

        describe('partial updates', () => {
            it('should handle move operations with single parameters', async () => {
                const mockResponse: Task = createMockTask({
                    id: '8485093752',
                    content: 'Minimal update task',
                    projectId: 'new-project-only',
                    url: 'https://todoist.com/showTask?id=8485093752',
                    addedAt: new Date('2025-08-13T22:10:07.123456Z'),
                })

                mockTodoistApi.moveTask.mockResolvedValue(mockResponse)

                const result = await updateTasks.execute(
                    {
                        tasks: [
                            {
                                id: '8485093752',
                                projectId: 'new-project-only',
                                // Only updating projectId (move operation)
                            },
                        ],
                    },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('8485093752', {
                    projectId: 'new-project-only',
                })
                expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

                // Verify result structure
                expect(result.textContent).toContain('Updated 1 task')
                const { structuredContent } = result
                expect(structuredContent).toEqual(
                    expect.objectContaining({
                        tasks: expect.arrayContaining([
                            expect.objectContaining({ id: '8485093752' }),
                        ]),
                    }),
                )
            })

            it('should handle empty updates (only id provided)', async () => {
                const result = await updateTasks.execute(
                    { tasks: [{ id: '8485093753' }] },
                    mockTodoistApi,
                )

                // No API calls should be made since no move parameters are provided
                expect(mockTodoistApi.moveTask).not.toHaveBeenCalled()
                expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

                // Returns empty results since no moves were processed
                expect(result.textContent).toContain('Updated 0 tasks')
                const { structuredContent } = result
                expect(structuredContent.tasks).toEqual([]) // Empty arrays are now kept as empty arrays
                expect(structuredContent.totalCount).toBe(0)
            })
        })

        describe('error handling', () => {
            it('should throw error when task has multiple move parameters', async () => {
                await expect(
                    updateTasks.execute(
                        {
                            tasks: [
                                {
                                    id: 'task-1',
                                    projectId: 'new-project',
                                    sectionId: 'new-section',
                                },
                            ],
                        },
                        mockTodoistApi,
                    ),
                ).rejects.toThrow(
                    'Task task-1: Only one of projectId, sectionId, or parentId can be specified at a time',
                )
            })

            it('should propagate API errors for individual task moves', async () => {
                const apiError = new Error('API Error: Task not found')
                mockTodoistApi.moveTask.mockRejectedValue(apiError)

                await expect(
                    updateTasks.execute(
                        { tasks: [{ id: 'non-existent-task', projectId: 'some-project' }] },
                        mockTodoistApi,
                    ),
                ).rejects.toThrow('API Error: Task not found')
            })

            it('should handle validation errors', async () => {
                const validationError = new Error('API Error: Invalid section ID')
                mockTodoistApi.moveTask.mockRejectedValue(validationError)

                await expect(
                    updateTasks.execute(
                        { tasks: [{ id: 'task-1', sectionId: 'invalid-section-format' }] },
                        mockTodoistApi,
                    ),
                ).rejects.toThrow('API Error: Invalid section ID')
            })

            it('should handle permission errors', async () => {
                const permissionError = new Error(
                    'API Error: Insufficient permissions to move task',
                )
                mockTodoistApi.moveTask.mockRejectedValue(permissionError)

                await expect(
                    updateTasks.execute(
                        { tasks: [{ id: 'restricted-task', projectId: 'restricted-project' }] },
                        mockTodoistApi,
                    ),
                ).rejects.toThrow('API Error: Insufficient permissions to move task')
            })

            it('should handle circular parent dependency errors', async () => {
                const circularError = new Error('API Error: Circular dependency detected')
                mockTodoistApi.moveTask.mockRejectedValue(circularError)

                await expect(
                    updateTasks.execute(
                        {
                            tasks: [
                                {
                                    id: 'task-parent',
                                    parentId: 'task-child', // This would create a circular dependency
                                },
                            ],
                        },
                        mockTodoistApi,
                    ),
                ).rejects.toThrow('API Error: Circular dependency detected')
            })
        })
    })

    describe('partial batch failures', () => {
        it('keeps successful updates when one task in the batch fails', async () => {
            const okTask = createMockTask({ id: 'ok-task', content: 'Updated ok' })
            mockTodoistApi.updateTask.mockResolvedValue(okTask)
            // The forbidden cross-workspace move shape the API rejects with 403.
            mockTodoistApi.moveTask.mockRejectedValue(
                Object.assign(new Error('Request failed with status code 403'), {
                    httpStatusCode: 403,
                    responseData: {
                        error: 'Not allowed to move objects out of a workspace',
                        error_tag: 'FORBIDDEN',
                        http_code: 403,
                    },
                }),
            )

            const result = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'ok-task', content: 'Updated ok' },
                        { id: 'bad-task', projectId: 'personal-project' },
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent } = result
            // The valid update is preserved instead of being discarded by the failure.
            expect(structuredContent.tasks).toHaveLength(1)
            expect(structuredContent.totalCount).toBe(1)
            expect(structuredContent.updatedTaskIds).toEqual(['ok-task'])

            // The failure is reported per-task, surfacing the error's message (matching the
            // add-tasks/complete-tasks pattern). The SDK's moveTask puts the generic status
            // text in error.message; the API objection lives in responseData and is not
            // echoed per item.
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('bad-task')
            expect(structuredContent.failures[0]?.error).toBe('Request failed with status code 403')
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 0,
                failureCount: 1,
            })

            // The text content tells the model not to retry the whole batch.
            expect(result.textContent).toContain('Updated 1 task')
            expect(result.textContent).toContain('Failed (1)')
            expect(result.textContent).toContain('not retried automatically')
        })

        it('throws when every task in the batch fails', async () => {
            mockTodoistApi.moveTask.mockRejectedValue(
                Object.assign(new Error('Request failed with status code 403'), {
                    httpStatusCode: 403,
                    responseData: {
                        error: 'Not allowed to move objects out of a workspace',
                        http_code: 403,
                    },
                }),
            )

            await expect(
                updateTasks.execute(
                    {
                        tasks: [
                            { id: 'bad-1', projectId: 'personal-project' },
                            { id: 'bad-2', projectId: 'personal-project' },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('All 2 task update(s) failed')
        })

        it('counts skipped (no-change) tasks separately from failures', async () => {
            const okTask = createMockTask({ id: 'ok-task', content: 'Updated ok' })
            mockTodoistApi.updateTask.mockResolvedValue(okTask)

            const result = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'ok-task', content: 'Updated ok' },
                        { id: 'noop-task' }, // only id -> skipped, not a failure
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(1)
            expect(structuredContent.failures).toHaveLength(0)
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 1,
                failureCount: 0,
            })
        })

        it('does not throw when the batch is only skipped and failed tasks', async () => {
            // No task is actually updated: one is a no-op skip, the other fails. A skip is
            // a successful no-op, so this is NOT a total failure and must return normally
            // with the failure listed — rather than throwing a batch-wide error.
            mockTodoistApi.moveTask.mockRejectedValue(
                Object.assign(new Error('Request failed with status code 403'), {
                    httpStatusCode: 403,
                    responseData: {
                        error: 'Not allowed to move objects out of a workspace',
                        http_code: 403,
                    },
                }),
            )

            const result = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'noop-task' }, // only id -> skipped
                        { id: 'bad-task', projectId: 'personal-project' }, // move -> fails
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(0)
            expect(structuredContent.totalCount).toBe(0)
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('bad-task')
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 0,
                skippedCount: 1,
                failureCount: 1,
            })
        })
    })

    describe('isUncompletable parameter', () => {
        it('should pass isUncompletable parameter to SDK', async () => {
            // Mock API response - minimal mock just to prevent errors
            const mockUpdatedTask: Task = createMockTask({
                id: 'task123',
                content: 'Updated Header',
            })

            mockTodoistApi.updateTask.mockResolvedValueOnce(mockUpdatedTask)

            await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: 'task123',
                            isUncompletable: true,
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify the parameter was passed to the SDK - this is the key test
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task123', {
                isUncompletable: true,
            })
        })
    })
})
