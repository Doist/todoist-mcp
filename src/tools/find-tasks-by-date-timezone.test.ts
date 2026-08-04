import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, type MockedFunction, vi } from 'vitest'
import { getTasksByFilter } from '../tool-helpers.js'
import { createMappedTask, createMockUser } from '../utils/test-helpers.js'
import { findTasksByDate } from './find-tasks-by-date.js'

// Mock only getTasksByFilter and user resolver — do NOT mock date-fns
vi.mock('../tool-helpers', async () => {
    const actual = (await vi.importActual('../tool-helpers')) as typeof import('../tool-helpers.js')
    return {
        ...actual,
        getTasksByFilter: vi.fn(),
    }
})

vi.mock('../utils/user-resolver', () => ({
    resolveUserNameToId: vi.fn(),
}))

const mockGetTasksByFilter = getTasksByFilter as MockedFunction<typeof getTasksByFilter>

const mockTodoistApi = {
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const mockTodoistUser = createMockUser()

describe('find-tasks-by-date timezone handling', () => {
    const originalTZ = process.env.TZ

    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getUser.mockResolvedValue(mockTodoistUser)

        const mockTasks = [createMappedTask({ content: 'Test task', dueDate: '2025-08-20' })]
        mockGetTasksByFilter.mockResolvedValue({ tasks: mockTasks, nextCursor: null })
    })

    afterEach(() => {
        // Restore original timezone
        if (originalTZ !== undefined) {
            process.env.TZ = originalTZ
        } else {
            delete process.env.TZ
        }
        vi.restoreAllMocks()
    })

    describe('explicit date in negative UTC offset (America/New_York, UTC-5)', () => {
        beforeEach(() => {
            process.env.TZ = 'America/New_York'
        })

        it('should compute correct end date for daysCount=1', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 1 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-21')
        })

        it('should compute correct end date for daysCount=3', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 3 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-23')
        })
    })

    describe('explicit date in positive UTC offset (Asia/Tokyo, UTC+9)', () => {
        beforeEach(() => {
            process.env.TZ = 'Asia/Tokyo'
        })

        it('should compute correct end date for daysCount=1', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 1 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-21')
        })

        it('should compute correct end date for daysCount=3', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 3 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-23')
        })
    })

    describe('"today" with daysCount > 1 across timezones', () => {
        // 2025-08-15T23:00:00Z
        // In America/New_York (UTC-4 in August/EDT): this is Aug 15, 7pm
        // In Asia/Tokyo (UTC+9): this is Aug 16, 8am

        it('should use local today in America/New_York (Aug 15)', async () => {
            process.env.TZ = 'America/New_York'
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-08-15T23:00:00Z'))

            try {
                await findTasksByDate.execute(
                    { startDate: 'today', limit: 50, daysCount: 3 },
                    mockTodoistApi,
                )

                const call = mockGetTasksByFilter.mock.calls[0]?.[0]
                // In New York, "now" is Aug 15
                expect(call?.query).toContain('due: 2025-08-15')
                expect(call?.query).toContain('due before: 2025-08-18')
            } finally {
                vi.useRealTimers()
            }
        })

        it('should use local today in Asia/Tokyo (Aug 16)', async () => {
            process.env.TZ = 'Asia/Tokyo'
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-08-15T23:00:00Z'))

            try {
                await findTasksByDate.execute(
                    { startDate: 'today', limit: 50, daysCount: 3 },
                    mockTodoistApi,
                )

                const call = mockGetTasksByFilter.mock.calls[0]?.[0]
                // In Tokyo, "now" is Aug 16
                expect(call?.query).toContain('due: 2025-08-16')
                expect(call?.query).toContain('due before: 2025-08-19')
            } finally {
                vi.useRealTimers()
            }
        })
    })
})
