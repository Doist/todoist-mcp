import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockTask } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { buildRescheduleDate, rescheduleTasks } from './reschedule-tasks.js'

const mockTodoistApi = {
    getTask: vi.fn(),
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { RESCHEDULE_TASKS } = ToolNames

describe(`${RESCHEDULE_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.sync.mockResolvedValue({
            syncStatus: {},
        })
    })

    describe('rescheduling non-recurring tasks', () => {
        it('should reschedule a date-only task to a new date', async () => {
            const task = createMockTask({
                id: 'task-1',
                due: {
                    date: '2026-03-15',
                    string: 'Mar 15',
                    isRecurring: false,
                },
            })
            mockTodoistApi.getTask.mockResolvedValue(task)

            await rescheduleTasks.execute(
                { tasks: [{ id: 'task-1', date: '2026-03-20' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'item_update',
                        args: {
                            id: 'task-1',
                            due: {
                                date: '2026-03-20',
                                string: 'Mar 15',
                                isRecurring: false,
                            },
                        },
                    }),
                ],
            })
        })
    })

    describe('rescheduling recurring tasks', () => {
        it('should preserve recurrence pattern when rescheduling', async () => {
            const task = createMockTask({
                id: 'task-1',
                due: {
                    date: '2026-03-15',
                    string: 'every day',
                    isRecurring: true,
                },
            })
            mockTodoistApi.getTask.mockResolvedValue(task)

            await rescheduleTasks.execute(
                { tasks: [{ id: 'task-1', date: '2026-03-20' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        type: 'item_update',
                        args: {
                            id: 'task-1',
                            due: {
                                date: '2026-03-20',
                                string: 'every day',
                                isRecurring: true,
                            },
                        },
                    }),
                ],
            })
        })
    })

    describe('time preservation', () => {
        it('should preserve existing time when input is date-only', async () => {
            const task = createMockTask({
                id: 'task-1',
                due: {
                    date: '2026-03-15',
                    datetime: '2026-03-15T10:00:00Z',
                    string: 'every day at 10am',
                    isRecurring: true,
                },
            })
            mockTodoistApi.getTask.mockResolvedValue(task)

            await rescheduleTasks.execute(
                { tasks: [{ id: 'task-1', date: '2026-03-20' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        args: expect.objectContaining({
                            due: expect.objectContaining({
                                date: '2026-03-20T10:00:00Z',
                            }),
                        }),
                    }),
                ],
            })
        })

        it('should use explicit datetime when provided', async () => {
            const task = createMockTask({
                id: 'task-1',
                due: {
                    date: '2026-03-15',
                    datetime: '2026-03-15T10:00:00Z',
                    string: 'every day at 10am',
                    isRecurring: true,
                },
            })
            mockTodoistApi.getTask.mockResolvedValue(task)

            await rescheduleTasks.execute(
                { tasks: [{ id: 'task-1', date: '2026-03-20T14:00:00' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        args: expect.objectContaining({
                            due: expect.objectContaining({
                                date: '2026-03-20T14:00:00',
                            }),
                        }),
                    }),
                ],
            })
        })
    })

    describe('timezone preservation', () => {
        it('should preserve timezone in sync command', async () => {
            const task = createMockTask({
                id: 'task-1',
                due: {
                    date: '2026-03-15',
                    datetime: '2026-03-15T10:00:00',
                    string: 'every day at 10am',
                    isRecurring: true,
                    timezone: 'America/New_York',
                },
            })
            mockTodoistApi.getTask.mockResolvedValue(task)

            await rescheduleTasks.execute(
                { tasks: [{ id: 'task-1', date: '2026-03-20' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                commands: [
                    expect.objectContaining({
                        args: expect.objectContaining({
                            due: expect.objectContaining({
                                timezone: 'America/New_York',
                            }),
                        }),
                    }),
                ],
            })
        })
    })

    describe('error handling', () => {
        it('should throw when task has no due date', async () => {
            const task = createMockTask({
                id: 'task-1',
                content: 'No date task',
                due: null,
            })
            mockTodoistApi.getTask.mockResolvedValue(task)

            await expect(
                rescheduleTasks.execute(
                    { tasks: [{ id: 'task-1', date: '2026-03-20' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('has no due date')
        })

        it('should throw when sync fails', async () => {
            const task = createMockTask({
                id: 'task-1',
                due: {
                    date: '2026-03-15',
                    string: 'Mar 15',
                    isRecurring: false,
                },
            })
            mockTodoistApi.getTask.mockResolvedValue(task)
            mockTodoistApi.sync.mockRejectedValue(new Error('Sync API error'))

            await expect(
                rescheduleTasks.execute(
                    { tasks: [{ id: 'task-1', date: '2026-03-20' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Reschedule failed: Sync API error')
        })
    })

    describe('batch operations', () => {
        it('should batch multiple tasks into a single sync call', async () => {
            const task1 = createMockTask({
                id: 'task-1',
                content: 'Task 1',
                due: {
                    date: '2026-03-15',
                    string: 'every day',
                    isRecurring: true,
                },
            })
            const task2 = createMockTask({
                id: 'task-2',
                content: 'Task 2',
                due: {
                    date: '2026-03-16',
                    string: 'every week',
                    isRecurring: true,
                },
            })

            const updatedTask1 = createMockTask({
                id: 'task-1',
                content: 'Task 1',
                due: { date: '2026-03-20', string: 'every day', isRecurring: true },
            })
            const updatedTask2 = createMockTask({
                id: 'task-2',
                content: 'Task 2',
                due: { date: '2026-03-21', string: 'every week', isRecurring: true },
            })

            mockTodoistApi.getTask
                .mockResolvedValueOnce(task1)
                .mockResolvedValueOnce(task2)
                // Re-fetch after sync
                .mockResolvedValueOnce(updatedTask1)
                .mockResolvedValueOnce(updatedTask2)

            await rescheduleTasks.execute(
                {
                    tasks: [
                        { id: 'task-1', date: '2026-03-20' },
                        { id: 'task-2', date: '2026-03-21' },
                    ],
                },
                mockTodoistApi,
            )

            // Single sync call with two commands
            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(1)
            const syncCall = mockTodoistApi.sync.mock.calls[0]
            if (!syncCall) throw new Error('Expected sync to have been called')
            expect(syncCall[0].commands).toHaveLength(2)
        })
    })

    describe('output format', () => {
        it('should re-fetch tasks and return mapped output', async () => {
            const task = createMockTask({
                id: 'task-1',
                content: 'Recurring task',
                due: {
                    date: '2026-03-15',
                    string: 'every day',
                    isRecurring: true,
                },
            })
            const updatedTask = createMockTask({
                id: 'task-1',
                content: 'Recurring task',
                due: {
                    date: '2026-03-20',
                    string: 'every day',
                    isRecurring: true,
                },
            })

            mockTodoistApi.getTask
                .mockResolvedValueOnce(task) // initial fetch
                .mockResolvedValueOnce(updatedTask) // re-fetch after sync

            const result = await rescheduleTasks.execute(
                { tasks: [{ id: 'task-1', date: '2026-03-20' }] },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('Rescheduled 1 task')
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    totalCount: 1,
                    rescheduledTaskIds: ['task-1'],
                    tasks: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'task-1',
                            dueDate: '2026-03-20',
                            recurring: 'every day',
                        }),
                    ]),
                }),
            )

            // Verify getTask called twice: once for reading, once for re-fetch
            expect(mockTodoistApi.getTask).toHaveBeenCalledTimes(2)
        })
    })
})

describe('buildRescheduleDate', () => {
    it('should return date-only input as-is when task has no time', () => {
        const result = buildRescheduleDate('2026-03-20', {
            date: '2026-03-15',
            string: 'Mar 15',
            isRecurring: false,
        })
        expect(result).toBe('2026-03-20')
    })

    it('should preserve time from existing datetime', () => {
        const result = buildRescheduleDate('2026-03-20', {
            date: '2026-03-15',
            datetime: '2026-03-15T10:30:00Z',
            string: 'every day at 10:30am',
            isRecurring: true,
        })
        expect(result).toBe('2026-03-20T10:30:00Z')
    })

    it('should use explicit datetime as-is', () => {
        const result = buildRescheduleDate('2026-03-20T14:00:00', {
            date: '2026-03-15',
            datetime: '2026-03-15T10:30:00Z',
            string: 'every day at 10:30am',
            isRecurring: true,
        })
        expect(result).toBe('2026-03-20T14:00:00')
    })
})
