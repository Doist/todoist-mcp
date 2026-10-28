import type { Reminder, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { resolveUserRefs } from '../utils/user-resolver.js'
import { updateReminders } from './update-reminders.js'

vi.mock('../utils/user-resolver.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/user-resolver.js')>()
    return { ...actual, resolveUserRefs: vi.fn() }
})

const mockResolveUserRefs = vi.mocked(resolveUserRefs)

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

    describe('changing who is notified', () => {
        beforeEach(() => {
            mockResolveUserRefs.mockResolvedValue([
                { userId: 'user-2', displayName: 'Ana', email: 'ana@example.com' },
            ])
        })

        it('should change only the recipient of a relative reminder', async () => {
            mockTodoistApi.updateReminder.mockResolvedValue(
                createMockRelativeReminder({ notifyUid: 'user-2' }),
            )

            const result = await updateReminders.execute(
                {
                    reminders: [{ type: 'relative', id: 'reminder-1', notifyUser: 'Ana' }],
                },
                mockTodoistApi,
            )

            expect(mockResolveUserRefs).toHaveBeenCalledWith(mockTodoistApi, ['Ana'])
            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith('reminder-1', {
                reminderType: 'relative',
                notifyUid: 'user-2',
            })
            expect(mockTodoistApi.updateReminder.mock.calls[0]?.[1]).not.toHaveProperty(
                'notifyUser',
            )
            expect(result.textContent).toBe('Updated 1 reminder')
            expect(result.structuredContent.reminders[0]?.notifyUid).toBe('user-2')
        })

        it('should change the recipient of a location reminder', async () => {
            mockTodoistApi.updateLocationReminder.mockResolvedValue(
                createMockLocationReminder({ notifyUid: 'user-2' }),
            )

            await updateReminders.execute(
                {
                    reminders: [
                        { type: 'location', id: 'reminder-3', name: 'Gym', notifyUser: 'Ana' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLocationReminder).toHaveBeenCalledWith('reminder-3', {
                name: 'Gym',
                notifyUid: 'user-2',
            })
        })

        it('should warn when the reminder still notifies someone else', async () => {
            mockTodoistApi.updateReminder.mockResolvedValue(
                createMockRelativeReminder({ notifyUid: 'user-1' }),
            )

            const result = await updateReminders.execute(
                {
                    reminders: [{ type: 'relative', id: 'reminder-1', notifyUser: 'Ana' }],
                },
                mockTodoistApi,
            )

            expect(result.textContent).toBe(
                'Updated 1 reminder\nWarning: reminder reminder-1 notifies user user-1, not the requested user user-2. Todoist did not apply notifyUser.',
            )
        })
    })

    describe('partial failures', () => {
        it('updates the other reminders when one notifyUser cannot be resolved', async () => {
            mockResolveUserRefs.mockImplementation(async (_client, refs) => {
                if (refs[0] === 'nobody@example.com') {
                    throw new Error('Could not find user(s): "nobody@example.com".')
                }
                return [{ userId: 'user-2', displayName: 'Ana', email: 'ana@example.com' }]
            })
            mockTodoistApi.updateReminder.mockResolvedValue(
                createMockRelativeReminder({ id: 'r-1', notifyUid: 'user-2' }),
            )

            const result = await updateReminders.execute(
                {
                    reminders: [
                        { type: 'relative', id: 'r-1', notifyUser: 'ana@example.com' },
                        { type: 'relative', id: 'r-2', notifyUser: 'nobody@example.com' },
                    ],
                },
                mockTodoistApi,
            )

            // The unresolvable recipient must not fall back to the default one.
            expect(mockTodoistApi.updateReminder).toHaveBeenCalledOnce()
            expect(mockTodoistApi.updateReminder).toHaveBeenCalledWith(
                'r-1',
                expect.objectContaining({ notifyUid: 'user-2' }),
            )
            expect(result.structuredContent.updatedReminderIds).toEqual(['r-1'])
            expect(result.structuredContent.failures).toEqual([
                { item: 'r-2', error: 'Could not find user(s): "nobody@example.com".' },
            ])
        })

        it('keeps the updated reminders when one in the batch fails', async () => {
            mockTodoistApi.updateReminder
                .mockResolvedValueOnce(createMockRelativeReminder({ id: 'r-1' }))
                .mockRejectedValueOnce(new Error('API Error: Reminder not found'))

            const result = await updateReminders.execute(
                {
                    reminders: [
                        { type: 'relative', id: 'r-1', minuteOffset: 30 },
                        { type: 'relative', id: 'missing', minuteOffset: 30 },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent.updatedReminderIds).toEqual(['r-1'])
            expect(result.structuredContent.failures).toEqual([
                { item: 'missing', error: 'API Error: Reminder not found' },
            ])
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                failureCount: 1,
            })
            expect(result.textContent).toContain('Updated 1 reminder')
            expect(result.textContent).toContain('Failed (1) - address or drop these items')
        })

        it('returns structured failures when every reminder in the batch fails', async () => {
            mockTodoistApi.updateReminder.mockRejectedValue(
                new Error('API Error: Reminder not found'),
            )

            const result = await updateReminders.execute(
                { reminders: [{ type: 'relative', id: 'missing', minuteOffset: 30 }] },
                mockTodoistApi,
            )

            expect(result.structuredContent.reminders).toEqual([])
            expect(result.structuredContent.appliedOperations.failureCount).toBe(1)
            expect(result.textContent).toContain('Updated 0 reminders')
        })

        it('retries a transient 5xx failure on a per-reminder call', async () => {
            vi.useFakeTimers()
            try {
                mockTodoistApi.updateReminder
                    .mockRejectedValueOnce(
                        Object.assign(new Error('Service Unavailable'), { httpStatusCode: 503 }),
                    )
                    .mockResolvedValueOnce(createMockRelativeReminder({ id: 'r-1' }))

                const promise = updateReminders.execute(
                    { reminders: [{ type: 'relative', id: 'r-1', minuteOffset: 30 }] },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.updateReminder).toHaveBeenCalledTimes(2)
                expect(result.structuredContent.updatedReminderIds).toEqual(['r-1'])
            } finally {
                vi.useRealTimers()
            }
        })
    })
})
