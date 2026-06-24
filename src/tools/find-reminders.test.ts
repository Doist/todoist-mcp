import type { LocationReminder, Reminder, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { findReminders } from './find-reminders.js'

const mockTodoistApi = {
    getReminder: vi.fn(),
    getLocationReminder: vi.fn(),
    getReminders: vi.fn(),
    getLocationReminders: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_REMINDERS } = ToolNames

function createMockRelativeReminder(overrides: Partial<Reminder> = {}): Reminder {
    return {
        id: 'reminder-1',
        notifyUid: 'user-1',
        itemId: 'task-1',
        isDeleted: false,
        type: 'relative',
        minuteOffset: 30,
        ...overrides,
    } as Reminder
}

function createMockAbsoluteReminder(overrides: Partial<Reminder> = {}): Reminder {
    return {
        id: 'reminder-2',
        notifyUid: 'user-1',
        itemId: 'task-1',
        isDeleted: false,
        type: 'absolute',
        due: {
            isRecurring: false,
            string: 'tomorrow at 3pm',
            date: '2025-12-31',
            datetime: '2025-12-31T15:00:00Z',
            timezone: 'America/New_York',
        },
        ...overrides,
    } as Reminder
}

function createMockLocationReminder(overrides: Partial<Reminder> = {}): Reminder {
    return {
        id: 'reminder-3',
        notifyUid: 'user-1',
        itemId: 'task-1',
        isDeleted: false,
        type: 'location',
        name: 'Office',
        locLat: '37.7749',
        locLong: '-122.4194',
        locTrigger: 'on_enter',
        radius: 100,
        ...overrides,
    } as Reminder
}

describe(`${FIND_REMINDERS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('finding by reminderId', () => {
        it('should find a time-based reminder by ID', async () => {
            const mockReminder = createMockRelativeReminder()
            mockTodoistApi.getReminder.mockResolvedValue(mockReminder)

            const result = await findReminders.execute({ reminderId: 'reminder-1' }, mockTodoistApi)

            expect(mockTodoistApi.getReminder).toHaveBeenCalledWith('reminder-1')
            expect(result.textContent).toBe('Found relative reminder (id=reminder-1)')
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    reminders: [
                        expect.objectContaining({
                            id: 'reminder-1',
                            taskId: 'task-1',
                            type: 'relative',
                            minuteOffset: 30,
                        }),
                    ],
                    searchType: 'reminder',
                    searchId: 'reminder-1',
                    totalCount: 1,
                }),
            )
        })
    })

    describe('finding by locationReminderId', () => {
        it('should find a location reminder by ID', async () => {
            const mockReminder = createMockLocationReminder()
            mockTodoistApi.getLocationReminder.mockResolvedValue(mockReminder)

            const result = await findReminders.execute(
                { locationReminderId: 'reminder-3' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getLocationReminder).toHaveBeenCalledWith('reminder-3')
            expect(result.textContent).toBe('Found location reminder (id=reminder-3)')
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    reminders: [
                        expect.objectContaining({
                            id: 'reminder-3',
                            taskId: 'task-1',
                            type: 'location',
                            name: 'Office',
                            locTrigger: 'on_enter',
                        }),
                    ],
                    searchType: 'location_reminder',
                    searchId: 'reminder-3',
                    totalCount: 1,
                }),
            )
        })
    })

    describe('finding by taskId', () => {
        it('should find all reminders for a task', async () => {
            const mockRelative = createMockRelativeReminder({ id: 'r-1' })
            const mockAbsolute = createMockAbsoluteReminder({ id: 'r-2' })
            const mockLocation = createMockLocationReminder({ id: 'r-3' })

            mockTodoistApi.getReminders.mockResolvedValue({
                results: [mockRelative, mockAbsolute],
                nextCursor: null,
            })
            mockTodoistApi.getLocationReminders.mockResolvedValue({
                results: [mockLocation as LocationReminder],
                nextCursor: null,
            })

            const result = await findReminders.execute({ taskId: 'task-1' }, mockTodoistApi)

            expect(mockTodoistApi.getReminders).toHaveBeenCalledWith(
                expect.objectContaining({ taskId: 'task-1' }),
            )
            expect(mockTodoistApi.getLocationReminders).toHaveBeenCalledWith(
                expect.objectContaining({ taskId: 'task-1' }),
            )

            expect(result.textContent).toBe(
                'Found 2 time-based reminders and 1 location reminder for task task-1',
            )
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    searchType: 'task',
                    searchId: 'task-1',
                    totalCount: 3,
                }),
            )
            expect(result.structuredContent.reminders).toHaveLength(3)
        })

        it('should handle no reminders found for task', async () => {
            mockTodoistApi.getReminders.mockResolvedValue({
                results: [],
                nextCursor: null,
            })
            mockTodoistApi.getLocationReminders.mockResolvedValue({
                results: [],
                nextCursor: null,
            })

            const result = await findReminders.execute({ taskId: 'task-999' }, mockTodoistApi)

            expect(result.textContent).toBe('No reminders found for task task-999')
            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.structuredContent.reminders).toHaveLength(0)
        })

        it('should handle only time-based reminders for task', async () => {
            const mockRelative = createMockRelativeReminder()
            mockTodoistApi.getReminders.mockResolvedValue({
                results: [mockRelative],
                nextCursor: null,
            })
            mockTodoistApi.getLocationReminders.mockResolvedValue({
                results: [],
                nextCursor: null,
            })

            const result = await findReminders.execute({ taskId: 'task-1' }, mockTodoistApi)

            expect(result.textContent).toBe('Found 1 time-based reminder for task task-1')
            expect(result.structuredContent.totalCount).toBe(1)
        })
    })

    describe('validation', () => {
        it('should throw when no parameters provided', async () => {
            await expect(findReminders.execute({}, mockTodoistApi)).rejects.toThrow(
                'One of taskId, reminderId, or locationReminderId must be provided.',
            )
        })

        it('should throw when multiple parameters provided', async () => {
            await expect(
                findReminders.execute(
                    { taskId: 'task-1', reminderId: 'reminder-1' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Only one of taskId, reminderId, or locationReminderId can be provided at a time.',
            )
        })
    })
})
