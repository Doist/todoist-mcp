import type { Reminder, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { resolveUserRefs } from '../utils/user-resolver.js'
import { addReminders } from './add-reminders.js'

vi.mock('../utils/user-resolver.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/user-resolver.js')>()
    return { ...actual, resolveUserRefs: vi.fn() }
})

const mockResolveUserRefs = vi.mocked(resolveUserRefs)

const USER_IDS: Record<string, string> = { me: 'user-1', 'ana@example.com': 'user-2' }

function mockUserLookup() {
    mockResolveUserRefs.mockImplementation(async (_client, refs) =>
        refs.map((ref) => {
            const userId = USER_IDS[ref]
            if (!userId) throw new Error(`Could not find user(s): "${ref}".`)
            return { userId, displayName: ref, email: ref }
        }),
    )
}

const mockTodoistApi = {
    addReminder: vi.fn(),
    addLocationReminder: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_REMINDERS } = ToolNames

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

describe(`${ADD_REMINDERS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('adding relative reminders', () => {
        it('should add a relative reminder', async () => {
            const mockReminder = createMockRelativeReminder()
            mockTodoistApi.addReminder.mockResolvedValue(mockReminder)

            const result = await addReminders.execute(
                {
                    reminders: [{ type: 'relative', taskId: 'task-1', minuteOffset: 30 }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addReminder).toHaveBeenCalledWith({
                taskId: 'task-1',
                reminderType: 'relative',
                minuteOffset: 30,
                service: undefined,
            })

            expect(result.textContent).toBe('Added 1 time-based reminder')
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
                    totalCount: 1,
                    addedReminderIds: ['reminder-1'],
                }),
            )
        })

        it('should pass isUrgent parameter for relative reminder', async () => {
            const mockReminder = createMockRelativeReminder({ isUrgent: true } as Partial<Reminder>)
            mockTodoistApi.addReminder.mockResolvedValue(mockReminder)

            const result = await addReminders.execute(
                {
                    reminders: [
                        {
                            type: 'relative',
                            taskId: 'task-1',
                            minuteOffset: 30,
                            isUrgent: true,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addReminder).toHaveBeenCalledWith({
                taskId: 'task-1',
                reminderType: 'relative',
                minuteOffset: 30,
                service: undefined,
                isUrgent: true,
            })

            expect(result.structuredContent.reminders[0]).toEqual(
                expect.objectContaining({ isUrgent: true }),
            )
        })

        it('should pass service parameter for relative reminder', async () => {
            const mockReminder = createMockRelativeReminder()
            mockTodoistApi.addReminder.mockResolvedValue(mockReminder)

            await addReminders.execute(
                {
                    reminders: [
                        { type: 'relative', taskId: 'task-1', minuteOffset: 60, service: 'email' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addReminder).toHaveBeenCalledWith({
                taskId: 'task-1',
                reminderType: 'relative',
                minuteOffset: 60,
                service: 'email',
            })
        })
    })

    describe('adding absolute reminders', () => {
        it('should add an absolute reminder', async () => {
            const mockReminder = createMockAbsoluteReminder()
            mockTodoistApi.addReminder.mockResolvedValue(mockReminder)

            const result = await addReminders.execute(
                {
                    reminders: [
                        {
                            type: 'absolute',
                            taskId: 'task-1',
                            due: { string: 'tomorrow at 3pm' },
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addReminder).toHaveBeenCalledWith({
                taskId: 'task-1',
                reminderType: 'absolute',
                due: { string: 'tomorrow at 3pm' },
                service: undefined,
            })

            expect(result.textContent).toBe('Added 1 time-based reminder')
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    reminders: [
                        expect.objectContaining({
                            id: 'reminder-2',
                            taskId: 'task-1',
                            type: 'absolute',
                            due: expect.objectContaining({
                                string: 'tomorrow at 3pm',
                                date: '2025-12-31',
                            }),
                        }),
                    ],
                    totalCount: 1,
                    addedReminderIds: ['reminder-2'],
                }),
            )
        })

        it('should pass isUrgent parameter for absolute reminder', async () => {
            const mockReminder = createMockAbsoluteReminder({
                isUrgent: true,
            } as Partial<Reminder>)
            mockTodoistApi.addReminder.mockResolvedValue(mockReminder)

            const result = await addReminders.execute(
                {
                    reminders: [
                        {
                            type: 'absolute',
                            taskId: 'task-1',
                            due: { string: 'tomorrow at 3pm' },
                            isUrgent: true,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addReminder).toHaveBeenCalledWith({
                taskId: 'task-1',
                reminderType: 'absolute',
                due: { string: 'tomorrow at 3pm' },
                service: undefined,
                isUrgent: true,
            })

            expect(result.structuredContent.reminders[0]).toEqual(
                expect.objectContaining({ isUrgent: true }),
            )
        })
    })

    describe('adding location reminders', () => {
        it('should add a location reminder', async () => {
            const mockReminder = createMockLocationReminder()
            mockTodoistApi.addLocationReminder.mockResolvedValue(mockReminder)

            const result = await addReminders.execute(
                {
                    reminders: [
                        {
                            type: 'location',
                            taskId: 'task-1',
                            name: 'Office',
                            locLat: '37.7749',
                            locLong: '-122.4194',
                            locTrigger: 'on_enter' as const,
                            radius: 100,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addLocationReminder).toHaveBeenCalledWith({
                taskId: 'task-1',
                name: 'Office',
                locLat: '37.7749',
                locLong: '-122.4194',
                locTrigger: 'on_enter',
                radius: 100,
            })

            expect(result.textContent).toBe('Added 1 location reminder')
            expect(result.structuredContent).toEqual(
                expect.objectContaining({
                    reminders: [
                        expect.objectContaining({
                            id: 'reminder-3',
                            taskId: 'task-1',
                            type: 'location',
                            name: 'Office',
                            locLat: '37.7749',
                            locLong: '-122.4194',
                            locTrigger: 'on_enter',
                            radius: 100,
                        }),
                    ],
                    totalCount: 1,
                    addedReminderIds: ['reminder-3'],
                }),
            )
        })
    })

    describe('mixed batch operations', () => {
        it('should add mixed reminder types in a single batch', async () => {
            const mockRelative = createMockRelativeReminder({ id: 'r-1', itemId: 'task-1' })
            const mockAbsolute = createMockAbsoluteReminder({ id: 'r-2', itemId: 'task-2' })
            const mockLocation = createMockLocationReminder({ id: 'r-3', itemId: 'task-3' })

            mockTodoistApi.addReminder
                .mockResolvedValueOnce(mockRelative)
                .mockResolvedValueOnce(mockAbsolute)
            mockTodoistApi.addLocationReminder.mockResolvedValue(mockLocation)

            const result = await addReminders.execute(
                {
                    reminders: [
                        { type: 'relative', taskId: 'task-1', minuteOffset: 15 },
                        { type: 'absolute', taskId: 'task-2', due: { date: '2025-12-31' } },
                        {
                            type: 'location',
                            taskId: 'task-3',
                            name: 'Home',
                            locLat: '40.7128',
                            locLong: '-74.0060',
                            locTrigger: 'on_leave' as const,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addReminder).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.addLocationReminder).toHaveBeenCalledTimes(1)

            expect(result.textContent).toBe('Added 2 time-based reminders and 1 location reminder')
            expect(result.structuredContent.totalCount).toBe(3)
            expect(result.structuredContent.addedReminderIds).toEqual(['r-1', 'r-2', 'r-3'])
        })
    })

    describe('choosing who is notified', () => {
        it('should leave the recipient to Todoist when notifyUser is omitted', async () => {
            mockTodoistApi.addReminder.mockResolvedValue(createMockRelativeReminder())

            const result = await addReminders.execute(
                { reminders: [{ type: 'relative', taskId: 'task-1', minuteOffset: 30 }] },
                mockTodoistApi,
            )

            expect(mockResolveUserRefs).not.toHaveBeenCalled()
            expect(mockTodoistApi.addReminder.mock.calls[0]?.[0]?.notifyUid).toBeUndefined()
            expect(result.structuredContent.reminders[0]?.notifyUid).toBe('user-1')
        })

        it('should resolve notifyUser for every reminder type', async () => {
            mockUserLookup()
            mockTodoistApi.addReminder
                .mockResolvedValueOnce(
                    createMockRelativeReminder({ id: 'r-1', notifyUid: 'user-2' }),
                )
                .mockResolvedValueOnce(
                    createMockAbsoluteReminder({ id: 'r-2', notifyUid: 'user-2' }),
                )
            mockTodoistApi.addLocationReminder.mockResolvedValue(
                createMockLocationReminder({ id: 'r-3', notifyUid: 'user-1' }),
            )

            const result = await addReminders.execute(
                {
                    reminders: [
                        {
                            type: 'relative',
                            taskId: 'task-1',
                            minuteOffset: 15,
                            notifyUser: 'ana@example.com',
                        },
                        {
                            type: 'absolute',
                            taskId: 'task-1',
                            due: { date: '2025-12-31' },
                            notifyUser: 'ana@example.com',
                        },
                        {
                            type: 'location',
                            taskId: 'task-1',
                            name: 'Home',
                            locLat: '40.7128',
                            locLong: '-74.0060',
                            locTrigger: 'on_enter',
                            notifyUser: 'me',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Each distinct reference is looked up once, however many reminders use it.
            expect(mockResolveUserRefs).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.addReminder).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ reminderType: 'relative', notifyUid: 'user-2' }),
            )
            expect(mockTodoistApi.addReminder).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ reminderType: 'absolute', notifyUid: 'user-2' }),
            )
            expect(mockTodoistApi.addLocationReminder).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Home', notifyUid: 'user-1' }),
            )
            expect(result.structuredContent.reminders.map((r) => r.notifyUid)).toEqual([
                'user-2',
                'user-2',
                'user-1',
            ])
            expect(result.textContent).toBe('Added 2 time-based reminders and 1 location reminder')
        })

        it('should not create any reminder when a notifyUser cannot be resolved', async () => {
            mockUserLookup()

            await expect(
                addReminders.execute(
                    {
                        reminders: [
                            {
                                type: 'relative',
                                taskId: 'task-1',
                                minuteOffset: 15,
                                notifyUser: 'nobody@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Could not find user(s): "nobody@example.com".')
            expect(mockTodoistApi.addReminder).not.toHaveBeenCalled()
        })

        it('should warn when the reminder does not notify the requested user', async () => {
            mockUserLookup()
            mockTodoistApi.addReminder.mockResolvedValue(
                createMockRelativeReminder({ id: 'r-1', notifyUid: 'user-1' }),
            )

            const result = await addReminders.execute(
                {
                    reminders: [
                        {
                            type: 'relative',
                            taskId: 'task-1',
                            minuteOffset: 15,
                            notifyUser: 'ana@example.com',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.textContent).toBe(
                'Added 1 time-based reminder\nWarning: reminder r-1 notifies user user-1, not the requested user user-2. Todoist did not apply notifyUser.',
            )
        })
    })
})
