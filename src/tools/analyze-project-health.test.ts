import type { ProjectHealth, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { analyzeProjectHealth } from './analyze-project-health.js'

const mockTodoistApi = {
    analyzeProjectHealth: vi.fn(),
} as unknown as Mocked<TodoistApi>

function createMockHealth(overrides: Partial<ProjectHealth> = {}): ProjectHealth {
    return {
        status: 'ON_TRACK',
        description: null,
        descriptionSummary: null,
        taskRecommendations: null,
        projectId: 'proj-123',
        updatedAt: new Date('2026-03-29T10:00:00Z'),
        isStale: false,
        updateInProgress: false,
        ...overrides,
    }
}

describe('analyze-project-health tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should have correct tool metadata', () => {
        expect(analyzeProjectHealth.name).toBe(ToolNames.ANALYZE_PROJECT_HEALTH)
        expect(analyzeProjectHealth.annotations).toEqual({
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
        })
    })

    it('should trigger analysis and return completed status', async () => {
        const mockHealth = createMockHealth({ status: 'EXCELLENT' })
        mockTodoistApi.analyzeProjectHealth.mockResolvedValue(mockHealth)

        const result = await analyzeProjectHealth.execute({ projectId: 'proj-123' }, mockTodoistApi)

        expect(mockTodoistApi.analyzeProjectHealth).toHaveBeenCalledWith('proj-123')

        expect(result.structuredContent).toMatchObject({
            projectId: 'proj-123',
            health: {
                status: 'EXCELLENT',
                isStale: false,
                updateInProgress: false,
            },
        })
        expect(result.structuredContent.message).toContain('Health analysis complete')
        expect(result.structuredContent.message).toContain('EXCELLENT')
    })

    it('should indicate when analysis is in progress', async () => {
        const mockHealth = createMockHealth({ updateInProgress: true })
        mockTodoistApi.analyzeProjectHealth.mockResolvedValue(mockHealth)

        const result = await analyzeProjectHealth.execute({ projectId: 'proj-123' }, mockTodoistApi)

        expect(result.structuredContent.message).toContain('in progress')
        expect(result.structuredContent.health).toMatchObject({
            updateInProgress: true,
        })
    })

    it('should propagate API errors', async () => {
        mockTodoistApi.analyzeProjectHealth.mockRejectedValue(new Error(TEST_ERRORS.API_RATE_LIMIT))

        await expect(
            analyzeProjectHealth.execute({ projectId: 'proj-123' }, mockTodoistApi),
        ).rejects.toThrow(TEST_ERRORS.API_RATE_LIMIT)
    })
})
