import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { ToolNames } from '../../utils/tool-names.js'
import { completeGoals, MAX_GOALS_PER_OPERATION } from '../complete-goals.js'

const mockTodoistApi = {
    completeGoal: vi.fn(),
    uncompleteGoal: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { COMPLETE_GOALS } = ToolNames

describe(`${COMPLETE_GOALS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should complete goals concurrently', async () => {
        mockTodoistApi.completeGoal.mockResolvedValue(undefined as never)

        const result = await completeGoals.execute(
            { ids: ['g-1', 'g-2'], action: 'complete' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.completeGoal).toHaveBeenCalledTimes(2)
        expect(mockTodoistApi.completeGoal).toHaveBeenCalledWith('g-1')
        expect(mockTodoistApi.completeGoal).toHaveBeenCalledWith('g-2')
        expect(mockTodoistApi.uncompleteGoal).not.toHaveBeenCalled()
        expect(result.structuredContent.successCount).toBe(2)
        expect(result.structuredContent.failureCount).toBe(0)
        expect(result.structuredContent.processed).toEqual(['g-1', 'g-2'])
    })

    it('should uncomplete goals when action is "uncomplete"', async () => {
        mockTodoistApi.uncompleteGoal.mockResolvedValue(undefined as never)

        await completeGoals.execute({ ids: ['g-1'], action: 'uncomplete' }, mockTodoistApi)

        expect(mockTodoistApi.uncompleteGoal).toHaveBeenCalledWith('g-1')
        expect(mockTodoistApi.completeGoal).not.toHaveBeenCalled()
    })

    it('should partition successes and failures', async () => {
        mockTodoistApi.completeGoal
            .mockResolvedValueOnce(undefined as never)
            .mockRejectedValueOnce(new Error('Goal not found'))
            .mockResolvedValueOnce(undefined as never)

        const result = await completeGoals.execute(
            { ids: ['g-1', 'g-2', 'g-3'], action: 'complete' },
            mockTodoistApi,
        )

        expect(result.structuredContent.processed).toEqual(['g-1', 'g-3'])
        expect(result.structuredContent.failures).toEqual([
            { item: 'g-2', error: 'Goal not found' },
        ])
        expect(result.structuredContent.successCount).toBe(2)
        expect(result.structuredContent.failureCount).toBe(1)
    })

    it(`should reject batches larger than ${MAX_GOALS_PER_OPERATION}`, () => {
        const oversized = Array.from({ length: MAX_GOALS_PER_OPERATION + 1 }, (_, i) => `g-${i}`)
        const result = completeGoals.parameters.ids.safeParse(oversized)
        expect(result.success).toBe(false)
    })
})
