import type { Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { resetLimitersForTesting } from '../utils/concurrency.js'
import { ConcurrencyLimits } from '../utils/constants.js'
import { convertPriorityToNumber } from '../utils/priorities.js'
import { createMockTask, createMockUser, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { updateTasks } from './update-tasks.js'

// Mock the Todoist API
const mockTodoistApi = {
    updateTask: vi.fn(),
    moveTask: vi.fn(),
    moveTasks: vi.fn(),
    getTasks: vi.fn(),
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_TASKS } = ToolNames

describe(`${UPDATE_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // The mock client is never registered, so it shares the process-wide
        // fallback limiters — reset them so queued work can't leak between cases.
        resetLimitersForTesting()
        mockTodoistApi.getUser.mockResolvedValue(createMockUser())
        // No current state known by default, so every requested move is performed —
        // the same behaviour as not checking at all.
        mockTodoistApi.getTasks.mockResolvedValue({ results: [], nextCursor: null })
    })

    async function expectSingleFailure(
        params: Parameters<typeof updateTasks.execute>[0]['tasks'][number],
        expectedError: string,
    ) {
        const result = await updateTasks.execute({ tasks: [params] }, mockTodoistApi)
        const { structuredContent } = result
        expect(structuredContent.tasks).toHaveLength(0)
        expect(structuredContent.failures).toHaveLength(1)
        expect(structuredContent.failures[0]?.item).toBe(params.id)
        expect(structuredContent.failures[0]?.error).toContain(expectedError)
        expect(structuredContent.appliedOperations).toEqual({
            updateCount: 0,
            skippedCount: 0,
            failureCount: 1,
            redundantMovesSkipped: 0,
        })
        return result
    }

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
        // The tool never throws for per-item problems — even a single failing task is
        // reported in the structured `failures` rather than rejecting the whole call.
        it('reports invalid duration format as a failure', async () => {
            await expectSingleFailure(
                { id: '8485093756', duration: 'invalid' },
                'Task 8485093756: Invalid duration format "invalid"',
            )
        })

        it('reports duration exceeding 24 hours as a failure', async () => {
            await expectSingleFailure(
                { id: '8485093757', duration: '25h' },
                'Task 8485093757: Invalid duration format "25h": Duration cannot exceed 24 hours (1440 minutes)',
            )
        })

        it('reports multiple move parameters as a failure', async () => {
            await expectSingleFailure(
                { id: '8485093748', projectId: 'new-project', sectionId: 'new-section' },
                'Only one of projectId, sectionId, or parentId can be specified at a time. ' +
                    'The Todoist API requires exactly one destination for move operations.',
            )
        })

        it('reports all three move parameters as a failure', async () => {
            await expectSingleFailure(
                { id: '8485093748', projectId: 'p1', sectionId: 's1', parentId: 't1' },
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
        ])('reports $error as a failure', async ({ error, params }) => {
            mockTodoistApi.updateTask.mockRejectedValue(new Error(error))
            await expectSingleFailure(params, error)
        })
    })

    describe('task organisation', () => {
        describe('organizing multiple tasks', () => {
            it('should move tasks sharing a destination in a single request', async () => {
                const sectionId = '6cfPqr9xgvmgW6J0'
                const mockResponses = [
                    createMockTask({ id: '6cPHJm59x4WhMwR4', content: 'First task', sectionId }),
                    createMockTask({ id: '6cPHJj2MV4HMj92W', content: 'Second task', sectionId }),
                ]

                mockTodoistApi.moveTasks.mockResolvedValue(mockResponses as Task[])

                const result = await updateTasks.execute(
                    {
                        tasks: [
                            { id: '6cPHJm59x4WhMwR4', sectionId },
                            { id: '6cPHJj2MV4HMj92W', sectionId },
                        ],
                    },
                    mockTodoistApi,
                )

                // One request carrying both moves, rather than two concurrent requests
                // contending on the same tree.
                expect(mockTodoistApi.moveTasks).toHaveBeenCalledTimes(1)
                expect(mockTodoistApi.moveTasks).toHaveBeenCalledWith(
                    ['6cPHJm59x4WhMwR4', '6cPHJj2MV4HMj92W'],
                    { sectionId },
                )
                expect(mockTodoistApi.moveTask).not.toHaveBeenCalled()
                expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()

                // Verify result structure
                expect(result.textContent).toContain('Updated 2 tasks')
                const { structuredContent } = result
                expect(structuredContent.tasks).toHaveLength(2)
                expect(structuredContent.totalCount).toBe(2)
                expect(structuredContent.updatedTaskIds).toEqual([
                    '6cPHJm59x4WhMwR4',
                    '6cPHJj2MV4HMj92W',
                ])
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
            // A move failure on the only task is reported in `failures`, not thrown.
            it('reports a task with multiple move parameters as a failure', async () => {
                await expectSingleFailure(
                    { id: 'task-1', projectId: 'new-project', sectionId: 'new-section' },
                    'Task task-1: Only one of projectId, sectionId, or parentId can be specified at a time',
                )
            })

            it('reports API errors for individual task moves as failures', async () => {
                mockTodoistApi.moveTask.mockRejectedValue(new Error('API Error: Task not found'))
                await expectSingleFailure(
                    { id: 'non-existent-task', projectId: 'some-project' },
                    'API Error: Task not found',
                )
            })

            it('reports validation errors as failures', async () => {
                mockTodoistApi.moveTask.mockRejectedValue(
                    new Error('API Error: Invalid section ID'),
                )
                await expectSingleFailure(
                    { id: 'task-1', sectionId: 'invalid-section-format' },
                    'API Error: Invalid section ID',
                )
            })

            it('reports permission errors as failures', async () => {
                mockTodoistApi.moveTask.mockRejectedValue(
                    new Error('API Error: Insufficient permissions to move task'),
                )
                await expectSingleFailure(
                    { id: 'restricted-task', projectId: 'restricted-project' },
                    'API Error: Insufficient permissions to move task',
                )
            })

            it('reports circular parent dependency errors as failures', async () => {
                mockTodoistApi.moveTask.mockRejectedValue(
                    new Error('API Error: Circular dependency detected'),
                )
                await expectSingleFailure(
                    { id: 'task-parent', parentId: 'task-child' },
                    'API Error: Circular dependency detected',
                )
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

            // The failure is reported per-task, preserving the API's specific objection
            // instead of the SDK's generic HTTP status message.
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('bad-task')
            expect(structuredContent.failures[0]?.error).toContain(
                'Not allowed to move objects out of a workspace',
            )
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 0,
                failureCount: 1,
                redundantMovesSkipped: 0,
            })

            // The text content surfaces the per-task failure alongside the success.
            expect(result.textContent).toContain('Updated 1 task')
            expect(result.textContent).toContain('Failed (1)')
            expect(result.textContent).toContain('address or drop these items')
        })

        it('returns a structured result (does not throw) when every task fails', async () => {
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
                        { id: 'bad-1', projectId: 'personal-project' },
                        { id: 'bad-2', projectId: 'personal-project' },
                    ],
                },
                mockTodoistApi,
            )

            // A total failure is reported structurally, not thrown — so the per-item
            // reasons survive instead of being flattened into one opaque error.
            const { structuredContent } = result
            expect(structuredContent.tasks).toHaveLength(0)
            expect(structuredContent.totalCount).toBe(0)
            expect(structuredContent.updatedTaskIds).toEqual([])
            expect(structuredContent.failures).toHaveLength(2)
            expect(structuredContent.failures.map((f) => f.item)).toEqual(['bad-1', 'bad-2'])
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 0,
                skippedCount: 0,
                failureCount: 2,
                redundantMovesSkipped: 0,
            })
            expect(result.textContent).toContain('Updated 0 tasks')
            expect(result.textContent).toContain('Failed (2)')
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
                redundantMovesSkipped: 0,
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
                redundantMovesSkipped: 0,
            })
        })

        it('reports a partial outcome when the move succeeds but the field update fails', async () => {
            // Combined move + field update where the move succeeds but updateTask rejects.
            // The response must disclose the move because retrying the whole item could
            // otherwise apply the same operation twice.
            const movedTask = createMockTask({
                id: 'move-update-task',
                projectId: 'new-project-id',
            })
            mockTodoistApi.moveTask.mockResolvedValue(movedTask)
            mockTodoistApi.updateTask.mockRejectedValue(new Error('API Error: Invalid priority'))

            const result = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: 'move-update-task',
                            projectId: 'new-project-id',
                            content: 'New content',
                        },
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent } = result
            expect(structuredContent.tasks).toEqual([
                expect.objectContaining({ id: 'move-update-task', projectId: 'new-project-id' }),
            ])
            expect(structuredContent.updatedTaskIds).toEqual(['move-update-task'])
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('move-update-task')
            expect(structuredContent.failures[0]?.error).toBe(
                'Move applied; field update failed: API Error: Invalid priority',
            )
            expect(structuredContent.failures[0]?.code).toBe('PARTIAL_MOVE_APPLIED')
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 0,
                failureCount: 1,
                redundantMovesSkipped: 0,
            })
        })

        it('truncates the failure list to 3 and shows "+N more"', async () => {
            // A non-throwing batch (one success keeps it from being a total failure) with
            // more than MAX_FAILURES_SHOWN (3) failures must cap the displayed list and
            // append "+N more" so the truncation isn't silently dropped by a refactor.
            mockTodoistApi.updateTask.mockImplementation((id: string) => {
                if (id === 'ok-task') {
                    return Promise.resolve(createMockTask({ id: 'ok-task', content: 'ok' }))
                }
                return Promise.reject(new Error('API Error: boom'))
            })

            const result = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'ok-task', content: 'ok' },
                        { id: 'bad-1', content: 'x' },
                        { id: 'bad-2', content: 'x' },
                        { id: 'bad-3', content: 'x' },
                        { id: 'bad-4', content: 'x' },
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent, textContent } = result
            // All 4 failures are retained in the structured output...
            expect(structuredContent.failures).toHaveLength(4)
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 0,
                failureCount: 4,
                redundantMovesSkipped: 0,
            })

            // ...but the text summary shows only the first 3 and notes the remainder.
            expect(textContent).toContain('Failed (4)')
            expect(textContent).toContain('bad-1')
            expect(textContent).toContain('bad-2')
            expect(textContent).toContain('bad-3')
            expect(textContent).not.toContain('bad-4')
            expect(textContent).toContain('+1 more')
        })

        it('retries a transient 5xx response on a per-item call', async () => {
            // A per-item 503 must be retried (the registerTool wrapper no longer fires now
            // that we settle each task, and the SDK transport doesn't retry 5xx responses).
            // The first attempt fails with 503, the retry succeeds, so the task is reported
            // as updated rather than a permanent failure.
            vi.useFakeTimers()
            try {
                const okTask = createMockTask({ id: 'retry-task', projectId: 'new-project-id' })
                mockTodoistApi.moveTask
                    .mockRejectedValueOnce(
                        Object.assign(new Error('HTTP 503: Service Unavailable'), {
                            httpStatusCode: 503,
                        }),
                    )
                    .mockResolvedValueOnce(okTask)

                const promise = updateTasks.execute(
                    { tasks: [{ id: 'retry-task', projectId: 'new-project-id' }] },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(2)
                expect(result.structuredContent.tasks).toHaveLength(1)
                expect(result.structuredContent.failures).toHaveLength(0)
            } finally {
                vi.useRealTimers()
            }
        })

        it('retries a transient 5xx response while resolving an inbox move', async () => {
            vi.useFakeTimers()
            try {
                const movedTask = createMockTask({
                    id: 'inbox-retry-task',
                    projectId: TEST_IDS.PROJECT_INBOX,
                })
                mockTodoistApi.getUser.mockRejectedValueOnce(
                    Object.assign(new Error('HTTP 503: Service Unavailable'), {
                        httpStatusCode: 503,
                    }),
                )
                mockTodoistApi.moveTask.mockResolvedValue(movedTask)

                const promise = updateTasks.execute(
                    { tasks: [{ id: 'inbox-retry-task', projectId: 'inbox' }] },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(2)
                expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('inbox-retry-task', {
                    projectId: TEST_IDS.PROJECT_INBOX,
                })
                expect(result.structuredContent.failures).toHaveLength(0)
            } finally {
                vi.useRealTimers()
            }
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

    describe('batch limits', () => {
        // The cap is enforced at both the MCP input boundary and in execute(), bounding
        // concurrent fan-out and the size of the failures response for direct callers too.
        const makeTasks = (count: number) =>
            Array.from({ length: count }, (_, i) => ({ id: `task-${i}`, content: 'x' }))

        it('accepts a batch at the cap (25)', () => {
            const result = z.object(updateTasks.parameters).safeParse({ tasks: makeTasks(25) })
            expect(result.success).toBe(true)
        })

        it('rejects a batch larger than the cap', () => {
            const result = z.object(updateTasks.parameters).safeParse({ tasks: makeTasks(26) })
            expect(result.success).toBe(false)
        })

        it('rejects an oversized batch when execute is called directly', async () => {
            await expect(
                updateTasks.execute({ tasks: makeTasks(26) }, mockTodoistApi),
            ).rejects.toThrow('Too big')
            expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()
        })
    })

    describe('redundant moves', () => {
        const TASK_ID = 'task-in-place'
        const PROJECT_ID = 'project-abc'

        /** Makes the prefetch report `task` as the current state of its id. */
        function currentlyIs(task: Task) {
            mockTodoistApi.getTasks.mockResolvedValue({ results: [task], nextCursor: null })
        }

        it('skips the move when the caller echoes back the current project', async () => {
            const task = createMockTask({
                id: TASK_ID,
                projectId: PROJECT_ID,
                sectionId: null,
                parentId: null,
            })
            currentlyIs(task)
            mockTodoistApi.updateTask.mockResolvedValue({ ...task, content: 'renamed' })

            const { structuredContent, textContent } = await updateTasks.execute(
                { tasks: [{ id: TASK_ID, projectId: PROJECT_ID, content: 'renamed' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).not.toHaveBeenCalled()
            expect(mockTodoistApi.moveTasks).not.toHaveBeenCalled()
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith(TASK_ID, { content: 'renamed' })
            expect(structuredContent.tasks).toHaveLength(1)
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 0,
                failureCount: 0,
                redundantMovesSkipped: 1,
            })
            expect(textContent).toContain('1 already in requested destination')
        })

        it('writes nothing at all when the echoed project is the only change', async () => {
            currentlyIs(
                createMockTask({
                    id: TASK_ID,
                    projectId: PROJECT_ID,
                    sectionId: null,
                    parentId: null,
                }),
            )

            const { structuredContent } = await updateTasks.execute(
                { tasks: [{ id: TASK_ID, projectId: PROJECT_ID }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).not.toHaveBeenCalled()
            expect(mockTodoistApi.moveTasks).not.toHaveBeenCalled()
            expect(mockTodoistApi.updateTask).not.toHaveBeenCalled()
            expect(structuredContent.tasks).toHaveLength(0)
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 0,
                skippedCount: 1,
                failureCount: 0,
                redundantMovesSkipped: 1,
            })
        })

        it('still moves a task whose project matches but which sits in a section', async () => {
            currentlyIs(
                createMockTask({
                    id: TASK_ID,
                    projectId: PROJECT_ID,
                    sectionId: 'section-1',
                    parentId: null,
                }),
            )
            mockTodoistApi.moveTask.mockResolvedValue(createMockTask({ id: TASK_ID }))

            const { structuredContent } = await updateTasks.execute(
                { tasks: [{ id: TASK_ID, projectId: PROJECT_ID }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith(TASK_ID, {
                projectId: PROJECT_ID,
            })
            expect(structuredContent.appliedOperations.redundantMovesSkipped).toBe(0)
        })

        it('still moves a task whose project matches but which has a parent', async () => {
            currentlyIs(
                createMockTask({
                    id: TASK_ID,
                    projectId: PROJECT_ID,
                    sectionId: null,
                    parentId: 'parent-1',
                }),
            )
            mockTodoistApi.moveTask.mockResolvedValue(createMockTask({ id: TASK_ID }))

            await updateTasks.execute(
                { tasks: [{ id: TASK_ID, projectId: PROJECT_ID }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith(TASK_ID, {
                projectId: PROJECT_ID,
            })
        })

        it('skips the move when the caller echoes back the current section', async () => {
            currentlyIs(createMockTask({ id: TASK_ID, sectionId: 'section-1', parentId: null }))

            const { structuredContent } = await updateTasks.execute(
                { tasks: [{ id: TASK_ID, sectionId: 'section-1' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).not.toHaveBeenCalled()
            expect(structuredContent.appliedOperations.redundantMovesSkipped).toBe(1)
        })

        it('skips the move when the caller echoes back the current parent', async () => {
            currentlyIs(createMockTask({ id: TASK_ID, parentId: 'parent-1' }))

            const { structuredContent } = await updateTasks.execute(
                { tasks: [{ id: TASK_ID, parentId: 'parent-1' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).not.toHaveBeenCalled()
            expect(structuredContent.appliedOperations.redundantMovesSkipped).toBe(1)
        })

        it('performs the real move when an unchanged project accompanies a section change', async () => {
            currentlyIs(
                createMockTask({
                    id: TASK_ID,
                    projectId: PROJECT_ID,
                    sectionId: null,
                    parentId: null,
                }),
            )
            mockTodoistApi.moveTask.mockResolvedValue(createMockTask({ id: TASK_ID }))

            const { structuredContent } = await updateTasks.execute(
                { tasks: [{ id: TASK_ID, projectId: PROJECT_ID, sectionId: 'section-2' }] },
                mockTodoistApi,
            )

            // Previously rejected as "only one of projectId, sectionId, or parentId".
            expect(structuredContent.failures).toHaveLength(0)
            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith(TASK_ID, {
                sectionId: 'section-2',
            })
        })

        it('applies field updates when every echoed container is unchanged', async () => {
            currentlyIs(
                createMockTask({
                    id: TASK_ID,
                    projectId: PROJECT_ID,
                    sectionId: 'section-1',
                    parentId: null,
                }),
            )
            mockTodoistApi.updateTask.mockResolvedValue(createMockTask({ id: TASK_ID }))

            const { structuredContent } = await updateTasks.execute(
                {
                    tasks: [
                        {
                            id: TASK_ID,
                            projectId: PROJECT_ID,
                            sectionId: 'section-1',
                            content: 'renamed',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(structuredContent.failures).toHaveLength(0)
            expect(mockTodoistApi.moveTask).not.toHaveBeenCalled()
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith(TASK_ID, { content: 'renamed' })
        })

        it('reads current state once for the whole batch', async () => {
            mockTodoistApi.moveTasks.mockResolvedValue([
                createMockTask({ id: 'task-a', projectId: PROJECT_ID }),
                createMockTask({ id: 'task-b', projectId: PROJECT_ID }),
            ])

            await updateTasks.execute(
                {
                    tasks: [
                        { id: 'task-a', projectId: PROJECT_ID },
                        { id: 'task-b', projectId: PROJECT_ID },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getTasks).toHaveBeenCalledTimes(1)
            // Comma-separated, not an array: the API rejects the JSON-array form the
            // SDK would otherwise serialise.
            expect(mockTodoistApi.getTasks).toHaveBeenNthCalledWith(1, {
                ids: 'task-a,task-b',
                limit: 25,
            })
        })

        it('does not read current state when no task is being moved', async () => {
            mockTodoistApi.updateTask.mockResolvedValue(createMockTask({ id: TASK_ID }))

            await updateTasks.execute(
                { tasks: [{ id: TASK_ID, content: 'renamed' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getTasks).not.toHaveBeenCalled()
        })

        it('moves anyway when the state read fails', async () => {
            mockTodoistApi.getTasks.mockRejectedValue(new Error('boom'))
            mockTodoistApi.moveTask.mockResolvedValue(createMockTask({ id: TASK_ID }))

            const { structuredContent } = await updateTasks.execute(
                { tasks: [{ id: TASK_ID, projectId: PROJECT_ID }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith(TASK_ID, {
                projectId: PROJECT_ID,
            })
            expect(structuredContent.failures).toHaveLength(0)
        })

        it('moves anyway when the task is missing from the state read', async () => {
            currentlyIs(createMockTask({ id: 'a-different-task', projectId: PROJECT_ID }))
            mockTodoistApi.moveTask.mockResolvedValue(createMockTask({ id: TASK_ID }))

            await updateTasks.execute(
                { tasks: [{ id: TASK_ID, projectId: PROJECT_ID }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith(TASK_ID, {
                projectId: PROJECT_ID,
            })
        })
    })

    describe('batched moves', () => {
        const DESTINATION = 'project-target'
        const IDS = ['task-a', 'task-b', 'task-c']

        function forbidden() {
            return Object.assign(new Error('Request failed with status code 403'), {
                httpStatusCode: 403,
                responseData: {
                    error: 'Not allowed to move objects out of a workspace',
                    error_tag: 'FORBIDDEN',
                    http_code: 403,
                },
            })
        }

        it('sends one request per destination, not per task', async () => {
            mockTodoistApi.moveTask.mockResolvedValue(createMockTask({ id: 'task-c' }))
            mockTodoistApi.moveTasks.mockResolvedValue([
                createMockTask({ id: 'task-a' }),
                createMockTask({ id: 'task-b' }),
            ])

            await updateTasks.execute(
                {
                    tasks: [
                        { id: 'task-a', projectId: DESTINATION },
                        { id: 'task-b', projectId: DESTINATION },
                        { id: 'task-c', projectId: 'somewhere-else' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTasks).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.moveTasks).toHaveBeenCalledWith(['task-a', 'task-b'], {
                projectId: DESTINATION,
            })
            // A lone move keeps the single-task endpoint.
            expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.moveTask).toHaveBeenCalledWith('task-c', {
                projectId: 'somewhere-else',
            })
        })

        it('reports only the tasks the batch failed to move', async () => {
            mockTodoistApi.moveTasks.mockRejectedValue(forbidden())
            mockTodoistApi.getTasks
                // Before the move, all three are elsewhere.
                .mockResolvedValueOnce({
                    results: IDS.map((id) => createMockTask({ id, projectId: 'original-project' })),
                    nextCursor: null,
                })
                // Two of the three commands landed before the batch reported a problem.
                .mockResolvedValueOnce({
                    results: [
                        createMockTask({ id: 'task-a', projectId: DESTINATION }),
                        createMockTask({ id: 'task-b', projectId: DESTINATION }),
                        createMockTask({ id: 'task-c', projectId: 'original-project' }),
                    ],
                    nextCursor: null,
                })

            const { structuredContent } = await updateTasks.execute(
                { tasks: IDS.map((id) => ({ id, projectId: DESTINATION })) },
                mockTodoistApi,
            )

            expect(structuredContent.updatedTaskIds).toEqual(['task-a', 'task-b'])
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('task-c')
            expect(structuredContent.failures[0]?.error).toContain(
                'Not allowed to move objects out of a workspace',
            )
        })

        it('does not apply field updates to a task whose move failed', async () => {
            mockTodoistApi.moveTasks.mockRejectedValue(forbidden())
            mockTodoistApi.getTasks
                .mockResolvedValueOnce({
                    results: IDS.map((id) => createMockTask({ id, projectId: 'original-project' })),
                    nextCursor: null,
                })
                .mockResolvedValueOnce({
                    results: [
                        createMockTask({ id: 'task-a', projectId: DESTINATION }),
                        createMockTask({ id: 'task-b', projectId: 'original-project' }),
                        createMockTask({ id: 'task-c', projectId: 'original-project' }),
                    ],
                    nextCursor: null,
                })
            mockTodoistApi.updateTask.mockResolvedValue(
                createMockTask({ id: 'task-a', content: 'renamed' }),
            )

            const { structuredContent } = await updateTasks.execute(
                { tasks: IDS.map((id) => ({ id, projectId: DESTINATION, content: 'renamed' })) },
                mockTodoistApi,
            )

            // Only the task that actually moved gets its content applied.
            expect(mockTodoistApi.updateTask).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-a', {
                content: 'renamed',
            })
            expect(structuredContent.updatedTaskIds).toEqual(['task-a'])
            expect(structuredContent.failures.map((failure) => failure.item)).toEqual([
                'task-b',
                'task-c',
            ])
        })

        it('reconciles every failed group from a single read', async () => {
            // Three destinations, two tasks each, all failing: reading per group would
            // cost three sequential reads on the error path.
            const ids = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2']
            mockTodoistApi.moveTasks.mockRejectedValue(forbidden())
            mockTodoistApi.getTasks.mockResolvedValue({
                results: ids.map((id) => createMockTask({ id, projectId: 'original-project' })),
                nextCursor: null,
            })

            const { structuredContent } = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'a1', projectId: 'dest-a' },
                        { id: 'a2', projectId: 'dest-a' },
                        { id: 'b1', projectId: 'dest-b' },
                        { id: 'b2', projectId: 'dest-b' },
                        { id: 'c1', projectId: 'dest-c' },
                        { id: 'c2', projectId: 'dest-c' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTasks).toHaveBeenCalledTimes(3)
            // One prefetch plus one reconcile, regardless of how many groups failed.
            expect(mockTodoistApi.getTasks).toHaveBeenCalledTimes(2)
            expect(structuredContent.failures).toHaveLength(6)
        })

        it('keeps outcomes separate when the same task id appears twice', async () => {
            // The schema permits a repeated id. Keying results by id would let the
            // second entry's outcome overwrite the first's.
            mockTodoistApi.moveTask.mockImplementation(
                async (id: string, args: { projectId?: string }) => {
                    if (args.projectId === 'project-b') {
                        throw new Error('API Error: cannot move to B')
                    }
                    return createMockTask({ id, projectId: args.projectId }) as Task
                },
            )

            const { structuredContent } = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'x', projectId: 'project-a' },
                        { id: 'x', projectId: 'project-b' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(2)
            // The successful move is reported as a success, not tarred with the failure
            // of the other entry for the same id.
            expect(structuredContent.updatedTaskIds).toEqual(['x'])
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.error).toContain('cannot move to B')
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 0,
                failureCount: 1,
                redundantMovesSkipped: 0,
            })
        })

        it('fails the whole group when the state read also fails', async () => {
            mockTodoistApi.moveTasks.mockRejectedValue(forbidden())
            mockTodoistApi.getTasks.mockRejectedValue(new Error('unavailable'))

            const { structuredContent } = await updateTasks.execute(
                { tasks: IDS.map((id) => ({ id, projectId: DESTINATION })) },
                mockTodoistApi,
            )

            expect(structuredContent.tasks).toHaveLength(0)
            expect(structuredContent.failures).toHaveLength(3)
            expect(structuredContent.failures[0]?.error).toContain(
                'Not allowed to move objects out of a workspace',
            )
        })

        it('checks rather than assumes when the response omits a task', async () => {
            mockTodoistApi.moveTasks.mockResolvedValue([
                createMockTask({ id: 'task-a', projectId: DESTINATION }),
                createMockTask({ id: 'task-b', projectId: DESTINATION }),
            ])
            mockTodoistApi.getTasks.mockResolvedValue({
                results: [createMockTask({ id: 'task-c', projectId: 'original-project' })],
                nextCursor: null,
            })

            const { structuredContent } = await updateTasks.execute(
                { tasks: IDS.map((id) => ({ id, projectId: DESTINATION })) },
                mockTodoistApi,
            )

            expect(structuredContent.updatedTaskIds).toEqual(['task-a', 'task-b'])
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('task-c')
            expect(structuredContent.failures[0]?.error).toContain('not returned by the move')
        })

        it('reports a partial outcome when a batched move lands but its field update fails', async () => {
            mockTodoistApi.moveTasks.mockResolvedValue([
                createMockTask({ id: 'task-a', projectId: DESTINATION }),
                createMockTask({ id: 'task-b', projectId: DESTINATION }),
            ])
            mockTodoistApi.updateTask
                .mockResolvedValueOnce(createMockTask({ id: 'task-a', content: 'renamed a' }))
                .mockRejectedValueOnce(new Error('API Error: update rejected'))

            const { structuredContent } = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'task-a', projectId: DESTINATION, content: 'renamed a' },
                        { id: 'task-b', projectId: DESTINATION, content: 'renamed b' },
                    ],
                },
                mockTodoistApi,
            )

            expect(structuredContent.updatedTaskIds).toEqual(['task-a', 'task-b'])
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('task-b')
            expect(structuredContent.failures[0]?.code).toBe('PARTIAL_MOVE_APPLIED')
            expect(structuredContent.failures[0]?.error).toContain('Move applied')
        })

        it('resolves the inbox once for the whole batch', async () => {
            const inboxProjectId = createMockUser().inboxProjectId
            mockTodoistApi.moveTasks.mockResolvedValue([
                createMockTask({ id: 'task-a', projectId: inboxProjectId }),
                createMockTask({ id: 'task-b', projectId: inboxProjectId }),
                createMockTask({ id: 'task-c', projectId: inboxProjectId }),
            ])

            await updateTasks.execute(
                { tasks: IDS.map((id) => ({ id, projectId: 'inbox' })) },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.moveTasks).toHaveBeenCalledWith(IDS, {
                projectId: inboxProjectId,
            })
        })

        it('fails only the inbox-bound tasks when the inbox lookup fails', async () => {
            mockTodoistApi.getUser.mockRejectedValue(new Error('API Error: user unavailable'))
            mockTodoistApi.updateTask.mockResolvedValue(
                createMockTask({ id: 'task-b', content: 'renamed' }),
            )

            const { structuredContent } = await updateTasks.execute(
                {
                    tasks: [
                        { id: 'task-a', projectId: 'inbox' },
                        { id: 'task-b', content: 'renamed' },
                    ],
                },
                mockTodoistApi,
            )

            expect(structuredContent.updatedTaskIds).toEqual(['task-b'])
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('task-a')
        })
    })

    describe('request concurrency', () => {
        /** Records the peak number of simultaneously in-flight calls to a mock. */
        function trackInFlight(mock: Mocked<TodoistApi>[keyof TodoistApi], result: Task) {
            const state = { max: 0, active: 0 }
            const release: Array<() => void> = []
            const mocked = mock as unknown as ReturnType<typeof vi.fn>
            mocked.mockImplementation(async () => {
                state.active++
                state.max = Math.max(state.max, state.active)
                await new Promise<void>((resolve) => release.push(resolve))
                state.active--
                return result
            })
            return {
                state,
                /**
                 * Releases calls as they arrive until the operation finishes, so the
                 * limiter — not the mock — decides how many run at once.
                 */
                async drain<T>(operation: Promise<T>): Promise<T> {
                    let settled = false
                    const tracked = operation.finally(() => {
                        settled = true
                    })
                    while (!settled) {
                        await new Promise((resolve) => setImmediate(resolve))
                        for (const resolve of release.splice(0)) {
                            resolve()
                        }
                    }
                    return tracked
                },
            }
        }

        it('never has more than one move in flight', async () => {
            const moved = createMockTask({ id: 'task-0' })
            const tracker = trackInFlight(mockTodoistApi.moveTask, moved)

            await tracker.drain(
                updateTasks.execute(
                    {
                        tasks: [
                            { id: 'task-0', projectId: 'project-a' },
                            { id: 'task-1', projectId: 'project-b' },
                            { id: 'task-2', projectId: 'project-c' },
                            { id: 'task-3', projectId: 'project-d' },
                        ],
                    },
                    mockTodoistApi,
                ),
            )

            expect(mockTodoistApi.moveTask).toHaveBeenCalledTimes(4)
            expect(tracker.state.max).toBe(ConcurrencyLimits.TASK_MOVES)
        })

        it('bounds concurrent field updates', async () => {
            const updated = createMockTask({ id: 'task-0' })
            const tracker = trackInFlight(mockTodoistApi.updateTask, updated)

            await tracker.drain(
                updateTasks.execute(
                    {
                        tasks: Array.from({ length: 10 }, (_, index) => ({
                            id: `task-${index}`,
                            content: 'renamed',
                        })),
                    },
                    mockTodoistApi,
                ),
            )

            expect(mockTodoistApi.updateTask).toHaveBeenCalledTimes(10)
            expect(tracker.state.max).toBe(ConcurrencyLimits.WRITES)
        })
    })
})
