import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { createMockGoal } from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { MAX_GOALS_PER_OPERATION, updateGoals } from '../update-goals.js'

const mockTodoistApi = {
    updateGoal: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_GOALS } = ToolNames

describe(`${UPDATE_GOALS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should update a single goal name', async () => {
        mockTodoistApi.updateGoal.mockResolvedValue(createMockGoal({ id: 'g-1', name: 'Renamed' }))

        const result = await updateGoals.execute(
            { goals: [{ id: 'g-1', name: 'Renamed' }] },
            mockTodoistApi,
        )

        expect(mockTodoistApi.updateGoal).toHaveBeenCalledWith('g-1', {
            name: 'Renamed',
            description: undefined,
            deadline: undefined,
            responsibleUid: undefined,
        })
        expect(result.structuredContent.totalCount).toBe(1)
        expect(result.structuredContent.updatedGoalIds).toEqual(['g-1'])
        expect(result.structuredContent.appliedOperations).toEqual({
            updateCount: 1,
            skippedCount: 0,
        })
    })

    it('should clear description with sentinel string', async () => {
        mockTodoistApi.updateGoal.mockResolvedValue(createMockGoal({ id: 'g-1' }))

        await updateGoals.execute({ goals: [{ id: 'g-1', description: 'remove' }] }, mockTodoistApi)

        expect(mockTodoistApi.updateGoal).toHaveBeenCalledWith('g-1', {
            description: null,
            deadline: undefined,
            responsibleUid: undefined,
        })
    })

    it('should clear deadline with sentinel string', async () => {
        mockTodoistApi.updateGoal.mockResolvedValue(createMockGoal({ id: 'g-1' }))

        await updateGoals.execute({ goals: [{ id: 'g-1', deadline: 'remove' }] }, mockTodoistApi)

        expect(mockTodoistApi.updateGoal).toHaveBeenCalledWith('g-1', {
            description: undefined,
            deadline: null,
            responsibleUid: undefined,
        })
    })

    it('should unassign responsibleUid with sentinel string', async () => {
        mockTodoistApi.updateGoal.mockResolvedValue(createMockGoal({ id: 'g-1' }))

        await updateGoals.execute(
            { goals: [{ id: 'g-1', responsibleUid: 'unassign' }] },
            mockTodoistApi,
        )

        expect(mockTodoistApi.updateGoal).toHaveBeenCalledWith('g-1', {
            description: undefined,
            deadline: undefined,
            responsibleUid: null,
        })
    })

    it.each([
        { field: 'description', value: null },
        { field: 'deadline', value: null },
        { field: 'responsibleUid', value: null },
    ])('should accept legacy null value for $field', async ({ field, value }) => {
        mockTodoistApi.updateGoal.mockResolvedValue(createMockGoal({ id: 'g-1' }))

        const parseResult = updateGoals.parameters.goals.safeParse([{ id: 'g-1', [field]: value }])

        expect(parseResult.success).toBe(true)
        if (parseResult.success) {
            await updateGoals.execute({ goals: parseResult.data }, mockTodoistApi)
            expect(mockTodoistApi.updateGoal).toHaveBeenCalledWith(
                'g-1',
                expect.objectContaining({ [field]: null }),
            )
        }
    })

    it('should skip goals with only an id (no fields to update)', async () => {
        const result = await updateGoals.execute({ goals: [{ id: 'g-1' }] }, mockTodoistApi)

        expect(mockTodoistApi.updateGoal).not.toHaveBeenCalled()
        expect(result.structuredContent.appliedOperations.skippedCount).toBe(1)
        expect(result.structuredContent.totalCount).toBe(0)
    })

    it(`should reject batches larger than ${MAX_GOALS_PER_OPERATION}`, () => {
        const oversized = Array.from({ length: MAX_GOALS_PER_OPERATION + 1 }, () => ({
            id: 'g',
            name: 'x',
        }))
        const result = updateGoals.parameters.goals.safeParse(oversized)
        expect(result.success).toBe(false)
    })
})
