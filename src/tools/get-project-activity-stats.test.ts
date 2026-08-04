import type { ProjectActivityStats, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { getProjectActivityStats } from './get-project-activity-stats.js'

const mockTodoistApi = {
    getProjectActivityStats: vi.fn(),
} as unknown as Mocked<TodoistApi>

function createMockStats(overrides: Partial<ProjectActivityStats> = {}): ProjectActivityStats {
    return {
        dayItems: [
            { date: '2026-03-29', totalCount: 5 },
            { date: '2026-03-28', totalCount: 8 },
            { date: '2026-03-27', totalCount: 3 },
        ],
        weekItems: null,
        ...overrides,
    }
}

describe('get-project-activity-stats tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should have correct tool metadata', () => {
        expect(getProjectActivityStats.name).toBe(ToolNames.GET_PROJECT_ACTIVITY_STATS)
        expect(getProjectActivityStats.annotations).toEqual({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        })
    })

    it('should return daily activity stats', async () => {
        const mockStats = createMockStats()
        mockTodoistApi.getProjectActivityStats.mockResolvedValue(mockStats)

        const result = await getProjectActivityStats.execute(
            { projectId: 'proj-123' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProjectActivityStats).toHaveBeenCalledWith('proj-123', {
            weeks: undefined,
            includeWeeklyCounts: undefined,
        })

        expect(result.structuredContent).toMatchObject({
            projectId: 'proj-123',
            dayItems: [
                { date: '2026-03-29', totalCount: 5 },
                { date: '2026-03-28', totalCount: 8 },
                { date: '2026-03-27', totalCount: 3 },
            ],
            weekItems: null,
        })

        expect(result.textContent).toContain('Daily Activity')
        expect(result.textContent).toContain('2026-03-29: 5 completed')
    })

    it('should pass weeks parameter to API', async () => {
        mockTodoistApi.getProjectActivityStats.mockResolvedValue(createMockStats())

        await getProjectActivityStats.execute({ projectId: 'proj-123', weeks: 8 }, mockTodoistApi)

        expect(mockTodoistApi.getProjectActivityStats).toHaveBeenCalledWith('proj-123', {
            weeks: 8,
            includeWeeklyCounts: undefined,
        })
    })

    it('should return weekly counts when includeWeeklyCounts is true', async () => {
        const mockStats = createMockStats({
            weekItems: [
                { fromDate: '2026-03-23', toDate: '2026-03-29', totalCount: 16 },
                { fromDate: '2026-03-16', toDate: '2026-03-22', totalCount: 22 },
            ],
        })
        mockTodoistApi.getProjectActivityStats.mockResolvedValue(mockStats)

        const result = await getProjectActivityStats.execute(
            { projectId: 'proj-123', includeWeeklyCounts: true },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProjectActivityStats).toHaveBeenCalledWith('proj-123', {
            weeks: undefined,
            includeWeeklyCounts: true,
        })

        expect(result.structuredContent).toMatchObject({
            weekItems: [
                { fromDate: '2026-03-23', toDate: '2026-03-29', totalCount: 16 },
                { fromDate: '2026-03-16', toDate: '2026-03-22', totalCount: 22 },
            ],
        })

        expect(result.textContent).toContain('Weekly Activity')
        expect(result.textContent).toContain('2026-03-23 to 2026-03-29: 16 completed')
    })

    it('should handle empty results', async () => {
        const mockStats = createMockStats({ dayItems: [], weekItems: null })
        mockTodoistApi.getProjectActivityStats.mockResolvedValue(mockStats)

        const result = await getProjectActivityStats.execute(
            { projectId: 'proj-123' },
            mockTodoistApi,
        )

        expect(result.structuredContent).toMatchObject({
            dayItems: [],
            weekItems: null,
        })
        expect(result.textContent).toContain('No daily activity data available')
    })

    it('should propagate API errors', async () => {
        mockTodoistApi.getProjectActivityStats.mockRejectedValue(
            new Error(TEST_ERRORS.API_RATE_LIMIT),
        )

        await expect(
            getProjectActivityStats.execute({ projectId: 'proj-123' }, mockTodoistApi),
        ).rejects.toThrow(TEST_ERRORS.API_RATE_LIMIT)
    })
})
