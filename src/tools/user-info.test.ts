import type { CurrentUser, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { userInfo } from './user-info.js'

// Mock the Todoist API
const mockTodoistApi = {
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { USER_INFO } = ToolNames

// Helper function to create a mock user with default values that can be overridden
function createMockUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
    return {
        id: '123',
        fullName: 'Test User',
        email: 'test@example.com',
        isPremium: true,
        premiumStatus: 'current_personal_plan',
        completedToday: 12,
        dailyGoal: 10,
        weeklyGoal: 100,
        startDay: 1, // Monday
        tzInfo: {
            timezone: 'Europe/Madrid',
            gmtString: '+02:00',
            hours: 2,
            minutes: 0,
            isDst: 1,
        },
        lang: 'en',
        avatarBig: 'https://example.com/avatar.jpg',
        avatarMedium: null,
        avatarS640: null,
        avatarSmall: null,
        karma: 86394.0,
        karmaTrend: 'up',
        nextWeek: 1,
        weekendStartDay: 6,
        timeFormat: 0,
        dateFormat: 0,
        daysOff: [6, 7],
        businessAccountId: null,
        completedCount: 102920,
        inboxProjectId: '6PVw8cMf7m8fWwRp',
        startPage: 'overdue',
        ...overrides,
    }
}

describe(`${USER_INFO} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should generate user info with all required fields', async () => {
        const mockUser = createMockUser()

        mockTodoistApi.getUser.mockResolvedValue(mockUser)

        const result = await userInfo.execute({}, mockTodoistApi)

        expect(mockTodoistApi.getUser).toHaveBeenCalledWith()

        // Test text content contains expected information
        const textContent = result.textContent
        expect(textContent).toContain('User ID:** 123')
        expect(textContent).toContain('Test User')
        expect(textContent).toContain('test@example.com')
        expect(textContent).toContain('Europe/Madrid')
        expect(textContent).toContain('Monday (1)')
        expect(textContent).toContain('Completed Today:** 12')
        expect(textContent).toContain('Plan:** Todoist Pro')

        // Test structured content
        const structuredContent = result.structuredContent
        expect(structuredContent).toEqual(
            expect.objectContaining({
                type: 'user_info',
                userId: '123',
                fullName: 'Test User',
                email: 'test@example.com',
                timezone: 'Europe/Madrid',
                startDay: 1,
                startDayName: 'Monday',
                completedToday: 12,
                dailyGoal: 10,
                weeklyGoal: 100,
                plan: 'Todoist Pro',
                currentLocalTime: expect.any(String),
                weekStartDate: expect.any(String),
                weekEndDate: expect.any(String),
                currentWeekNumber: expect.any(Number),
            }),
        )

        // Verify date formats
        expect(structuredContent.weekStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(structuredContent.weekEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(structuredContent.currentLocalTime).toMatch(
            /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/,
        )
    })

    it('should handle missing timezone info', async () => {
        const mockUser = createMockUser({
            isPremium: false,
            tzInfo: {
                timezone: 'UTC',
                gmtString: '+00:00',
                hours: 0,
                minutes: 0,
                isDst: 0,
            },
        })

        mockTodoistApi.getUser.mockResolvedValue(mockUser)

        const result = await userInfo.execute({}, mockTodoistApi)

        const textContent = result.textContent
        expect(textContent).toContain('UTC') // Should default to UTC
        expect(textContent).toContain('Monday (1)') // Should default to Monday
        expect(textContent).toContain('Plan:** Todoist Free')

        const structuredContent = result.structuredContent
        expect(structuredContent.timezone).toBe('UTC')
        expect(structuredContent.startDay).toBe(1)
        expect(structuredContent.startDayName).toBe('Monday')
        expect(structuredContent.plan).toBe('Todoist Free')
    })

    it('should handle invalid timezone and fallback to UTC', async () => {
        const mockUser = createMockUser({
            startDay: 2, // Tuesday
            tzInfo: {
                timezone: 'Invalid/Timezone',
                gmtString: '+05:30',
                hours: 5,
                minutes: 30,
                isDst: 0,
            },
        })

        mockTodoistApi.getUser.mockResolvedValue(mockUser)

        const result = await userInfo.execute({}, mockTodoistApi)

        const textContent = result.textContent
        expect(textContent).toContain('UTC') // Should fallback to UTC
        expect(textContent).toContain('Tuesday (2)')

        const structuredContent = result.structuredContent
        expect(structuredContent.timezone).toBe('UTC') // Should be UTC, not the invalid timezone
        expect(structuredContent.startDay).toBe(2)
        expect(structuredContent.startDayName).toBe('Tuesday')
        expect(structuredContent.currentLocalTime).toMatch(
            /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/,
        )
    })

    it('should propagate API errors', async () => {
        const apiError = new Error(TEST_ERRORS.API_UNAUTHORIZED)
        mockTodoistApi.getUser.mockRejectedValue(apiError)

        await expect(userInfo.execute({}, mockTodoistApi)).rejects.toThrow(
            TEST_ERRORS.API_UNAUTHORIZED,
        )
    })
})
