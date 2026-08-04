import type { ProductivityStats, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { getProductivityStats } from './get-productivity-stats.js'

const mockTodoistApi = {
    getProductivityStats: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { GET_PRODUCTIVITY_STATS } = ToolNames

function createMockStats(overrides: Partial<ProductivityStats> = {}): ProductivityStats {
    return {
        completedCount: 5230,
        daysItems: [
            {
                date: '2026-03-17',
                totalCompleted: 12,
                items: [
                    { id: 'proj1', completed: 8 },
                    { id: 'proj2', completed: 4 },
                ],
            },
            {
                date: '2026-03-16',
                totalCompleted: 8,
                items: [{ id: 'proj1', completed: 8 }],
            },
            {
                date: '2026-03-15',
                totalCompleted: 5,
                items: [{ id: 'proj2', completed: 5 }],
            },
        ],
        weekItems: [
            {
                from: '2026-03-11',
                to: '2026-03-17',
                totalCompleted: 45,
                items: [
                    { id: 'proj1', completed: 30 },
                    { id: 'proj2', completed: 15 },
                ],
            },
            {
                from: '2026-03-04',
                to: '2026-03-10',
                totalCompleted: 38,
                items: [{ id: 'proj1', completed: 38 }],
            },
        ],
        goals: {
            dailyGoal: 10,
            weeklyGoal: 50,
            currentDailyStreak: { count: 14, start: '2026-03-04', end: '2026-03-17' },
            currentWeeklyStreak: { count: 6, start: '2026-02-02', end: '2026-03-17' },
            lastDailyStreak: { count: 7, start: '2026-02-20', end: '2026-02-26' },
            lastWeeklyStreak: { count: 3, start: '2026-01-05', end: '2026-01-25' },
            maxDailyStreak: { count: 30, start: '2025-11-01', end: '2025-11-30' },
            maxWeeklyStreak: { count: 12, start: '2025-09-01', end: '2025-11-24' },
            user: 'user123',
            userId: 'user123',
            vacationMode: false,
            karmaDisabled: false,
            ignoreDays: ['Saturday', 'Sunday'],
        },
        karma: 86394,
        karmaTrend: 'up',
        karmaLastUpdate: 1742230800,
        karmaGraphData: [
            { date: '2026-03-10', karmaAvg: 86200 },
            { date: '2026-03-17', karmaAvg: 86394 },
        ],
        karmaUpdateReasons: [
            {
                time: '2026-03-17T10:00:00Z',
                newKarma: 86394,
                positiveKarma: 20,
                negativeKarma: 0,
                positiveKarmaReasons: [{ reason: 'completed_task', count: 4 }],
                negativeKarmaReasons: [],
            },
        ],
        projectColors: {
            proj1: 'berry_red',
            proj2: 'blue',
        },
        ...overrides,
    }
}

describe(`${GET_PRODUCTIVITY_STATS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return comprehensive productivity statistics', async () => {
        const mockStats = createMockStats()
        mockTodoistApi.getProductivityStats.mockResolvedValue(mockStats)

        const result = await getProductivityStats.execute({}, mockTodoistApi)

        expect(mockTodoistApi.getProductivityStats).toHaveBeenCalledWith()

        // Verify structured content
        const sc = result.structuredContent
        expect(sc?.completedCount).toBe(5230)
        expect(sc?.karma).toBe(86394)
        expect(sc?.karmaTrend).toBe('up')
        expect(sc?.goals.dailyGoal).toBe(10)
        expect(sc?.goals.weeklyGoal).toBe(50)
        expect(sc?.goals.currentDailyStreak.count).toBe(14)
        expect(sc?.goals.currentWeeklyStreak.count).toBe(6)
        expect(sc?.goals.maxDailyStreak.count).toBe(30)
        expect(sc?.goals.maxWeeklyStreak.count).toBe(12)
        expect(sc?.goals.vacationMode).toBe(false)
        expect(sc?.goals.karmaDisabled).toBe(false)
        expect(sc?.daysItems).toHaveLength(3)
        expect(sc?.weekItems).toHaveLength(2)
        expect(sc?.karmaGraphData).toHaveLength(2)
        expect(sc?.karmaUpdateReasons).toHaveLength(1)
        expect(sc?.projectColors).toEqual({ proj1: 'berry_red', proj2: 'blue' })
    })

    it('should include key stats in text content', async () => {
        const mockStats = createMockStats()
        mockTodoistApi.getProductivityStats.mockResolvedValue(mockStats)

        const result = await getProductivityStats.execute({}, mockTodoistApi)

        const text = result.textContent
        expect(text).toContain('5,230')
        expect(text).toContain('86,394')
        expect(text).toContain('up')
        expect(text).toContain('10 tasks/day')
        expect(text).toContain('50 tasks/week')
        expect(text).toContain('14 days')
        expect(text).toContain('6 weeks')
        expect(text).toContain('30 days')
        expect(text).toContain('12 weeks')
    })

    it('should include daily completion breakdown in text content', async () => {
        const mockStats = createMockStats()
        mockTodoistApi.getProductivityStats.mockResolvedValue(mockStats)

        const result = await getProductivityStats.execute({}, mockTodoistApi)

        const text = result.textContent
        expect(text).toContain('2026-03-17: 12 tasks')
        expect(text).toContain('2026-03-16: 8 tasks')
        expect(text).toContain('2026-03-15: 5 tasks')
    })

    it('should include weekly completion breakdown in text content', async () => {
        const mockStats = createMockStats()
        mockTodoistApi.getProductivityStats.mockResolvedValue(mockStats)

        const result = await getProductivityStats.execute({}, mockTodoistApi)

        const text = result.textContent
        expect(text).toContain('2026-03-11 to 2026-03-17: 45 tasks')
        expect(text).toContain('2026-03-04 to 2026-03-10: 38 tasks')
    })

    it('should handle empty days and weeks gracefully', async () => {
        const mockStats = createMockStats({ daysItems: [], weekItems: [] })
        mockTodoistApi.getProductivityStats.mockResolvedValue(mockStats)

        const result = await getProductivityStats.execute({}, mockTodoistApi)

        const text = result.textContent
        expect(text).not.toContain('Recent Daily Completions')
        expect(text).not.toContain('Recent Weekly Completions')
        expect(result.structuredContent?.daysItems).toHaveLength(0)
        expect(result.structuredContent?.weekItems).toHaveLength(0)
    })

    it('should propagate API errors', async () => {
        const apiError = new Error(TEST_ERRORS.API_UNAUTHORIZED)
        mockTodoistApi.getProductivityStats.mockRejectedValue(apiError)

        await expect(getProductivityStats.execute({}, mockTodoistApi)).rejects.toThrow(
            TEST_ERRORS.API_UNAUTHORIZED,
        )
    })

    it('should have correct tool metadata', () => {
        expect(getProductivityStats.name).toBe('get-productivity-stats')
        expect(getProductivityStats.annotations.readOnlyHint).toBe(true)
        expect(getProductivityStats.annotations.destructiveHint).toBe(false)
        expect(getProductivityStats.annotations.idempotentHint).toBe(true)
    })
})
