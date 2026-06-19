import type { Reminder, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { updateReminders } from './update-reminders.js'

const mockTodoistApi = {
    updateReminder: vi.fn(),
    updateLocationReminder: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_REMINDERS } = ToolNames

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

describe(`${UPDATE_REMINDERS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('updating relative reminders', () => {
        it('should update a relative reminder', async () => {
            const updatedReminder = createMockRelativeReminder({ minuteOffset: 60 })
            mockTodoistApi.updateReminder.mockResolvedValue(updatedReminder)

            const result = await updateReminders.execute(
                {
                    reminders: [{ type: 'relative', id: 'reminder-1', minuteOffset: 60 }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith('reminder-1', {
                reminderType: 'relative',
                minuteOffset: 60,
            })

            expect(result.textContent).toBe('Updated 1 reminder')
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    reminders: [
                        expect.objectContaining({
                            id: 'reminder-1',
                            type: 'relative',
                            minuteOffset: 60,
                        }),
                    ],
                    totalCount: 1,
                    updatedReminderIds: ['reminder-1'],
                }),
            )
        })

        it('should update isUrgent for relative reminder', async () => {
            const updatedReminder = createMockRelativeReminder({
                isUrgent: true,
            } as Partial<Reminder>)
            mockTodoistApi.updateReminder.mockResolvedValue(updatedReminder)

            const result = await updateReminders.execute(
                {
                    reminders: [{ type: 'relative', id: 'reminder-1', isUrgent: true }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith('reminder-1', {
                reminderType: 'relative',
                isUrgent: true,
            })

            expect(result.structuredContent.reminders[0]).toEqual(
                expect.objectContaining({ isUrgent: true }),
            )
        })

        it('should clear isUrgent with false for relative reminder', async () => {
            const updatedReminder = createMockRelativeReminder({
                isUrgent: false,
            } as Partial<Reminder>)
            mockTodoistApi.updateReminder.mockResolvedValue(updatedReminder)

            const result = await updateReminders.execute(
                {
                    reminders: [{ type: 'relative', id: 'reminder-1', isUrgent: false }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith('reminder-1', {
                reminderType: 'relative',
                isUrgent: false,
            })

            expect(result.structuredContent.reminders[0]).toEqual(
                expect.objectContaining({ isUrgent: false }),
            )
        })

        it('should update service for relative reminder', async () => {
            const updatedReminder = createMockRelativeReminder()
            mockTodoistApi.updateReminder.mockResolvedValue(updatedReminder)

            await updateReminders.execute(
                {
                    reminders: [{ type: 'relative', id: 'reminder-1', service: 'email' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith('reminder-1', {
                reminderType: 'relative',
                service: 'email',
            })
        })
    })

    describe('updating absolute reminders', () => {
        it('should update an absolute reminder', async () => {
            const updatedReminder = createMockAbsoluteReminder()
            mockTodoistApi.updateReminder.mockResolvedValue(updatedReminder)

            const result = await updateReminders.execute(
                {
                    reminders: [
                        {
                            type: 'absolute',
                            id: 'reminder-2',
                            due: { string: 'next Friday at 2pm' },
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith('reminder-2', {
                reminderType: 'absolute',
                due: { string: 'next Friday at 2pm' },
            })

            expect(result.textContent).toBe('Updated 1 reminder')
            expect(result.structuredContent.updatedReminderIds).toEqual(['reminder-2'])
        })

        it('should update isUrgent for absolute reminder', async () => {
            const updatedReminder = createMockAbsoluteReminder({
                isUrgent: true,
            } as Partial<Reminder>)
            mockTodoistApi.updateReminder.mockResolvedValue(updatedReminder)

            const result = await updateReminders.execute(
                {
                    reminders: [{ type: 'absolute', id: 'reminder-2', isUrgent: true }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith('reminder-2', {
                reminderType: 'absolute',
                isUrgent: true,
            })

            expect(result.structuredContent.reminders[0]).toEqual(
                expect.objectContaining({ isUrgent: true }),
            )
        })
    })

    describe('updating location reminders', () => {
        it('should update a location reminder', async () => {
            const updatedReminder = createMockLocationReminder({ name: 'New Office' })
            mockTodoistApi.updateLocationReminder.mockResolvedValue(updatedReminder)

            const result = await updateReminders.execute(
                {
                    reminders: [{ type: 'location', id: 'reminder-3', name: 'New Office' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLocationReminder).toHaveBeenCalledWith('reminder-3', {
                name: 'New Office',
            })

            expect(result.textContent).toBe('Updated 1 reminder')
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    reminders: [
                        expect.objectContaining({
                            id: 'reminder-3',
                            type: 'location',
                            name: 'New Office',
                        }),
                    ],
                    totalCount: 1,
                    updatedReminderIds: ['reminder-3'],
                }),
            )
        })

        it('should partially update location reminder fields', async () => {
            const updatedReminder = createMockLocationReminder({
                locTrigger: 'on_leave',
                radius: 200,
            })
            mockTodoistApi.updateLocationReminder.mockResolvedValue(updatedReminder)

            await updateReminders.execute(
                {
                    reminders: [
                        {
                            type: 'location',
                            id: 'reminder-3',
                            locTrigger: 'on_leave' as const,
                            radius: 200,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLocationReminder).toHaveBeenCalledWith('reminder-3', {
                locTrigger: 'on_leave',
                radius: 200,
            })
        })
    })

    describe('bulk updates', () => {
        it('should update multiple reminders of different types', async () => {
            const updatedRelative = createMockRelativeReminder({ id: 'r-1', minuteOffset: 45 })
            const updatedLocation = createMockLocationReminder({ id: 'r-2', name: 'Gym' })

            mockTodoistApi.updateReminder.mockResolvedValue(updatedRelative)
            mockTodoistApi.updateLocationReminder.mockResolvedValue(updatedLocation)

            const result = await updateReminders.execute(
                {
                    reminders: [
                        { type: 'relative', id: 'r-1', minuteOffset: 45 },
                        { type: 'location', id: 'r-2', name: 'Gym' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateReminder).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.updateLocationReminder).toHaveBeenCalledTimes(1)

            expect(result.textContent).toBe('Updated 2 reminders')
            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.structuredContent.updatedReminderIds).toEqual(['r-1', 'r-2'])
        })
    })
})
