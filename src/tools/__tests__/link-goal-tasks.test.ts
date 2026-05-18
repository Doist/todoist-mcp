import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { ToolNames } from '../../utils/tool-names.js'
import { linkGoalTasks, MAX_TASKS_PER_OPERATION } from '../link-goal-tasks.js'

const mockTodoistApi = {
    linkTaskToGoal: vi.fn(),
    unlinkTaskFromGoal: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { LINK_GOAL_TASKS } = ToolNames

describe(`${LINK_GOAL_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should link tasks to a goal concurrently', async () => {
        mockTodoistApi.linkTaskToGoal.mockResolvedValue(undefined as never)

        const result = await linkGoalTasks.execute(
            { goalId: 'g-1', taskIds: ['t-1', 't-2'], action: 'link' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.linkTaskToGoal).toHaveBeenCalledTimes(2)
        expect(mockTodoistApi.linkTaskToGoal).toHaveBeenCalledWith({ goalId: 'g-1', taskId: 't-1' })
        expect(mockTodoistApi.linkTaskToGoal).toHaveBeenCalledWith({ goalId: 'g-1', taskId: 't-2' })
        expect(mockTodoistApi.unlinkTaskFromGoal).not.toHaveBeenCalled()
        expect(result.structuredContent.successCount).toBe(2)
        expect(result.structuredContent.processed).toEqual(['t-1', 't-2'])
    })

    it('should unlink tasks when action is "unlink"', async () => {
        mockTodoistApi.unlinkTaskFromGoal.mockResolvedValue(undefined as never)

        await linkGoalTasks.execute(
            { goalId: 'g-1', taskIds: ['t-1'], action: 'unlink' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.unlinkTaskFromGoal).toHaveBeenCalledWith({
            goalId: 'g-1',
            taskId: 't-1',
        })
        expect(mockTodoistApi.linkTaskToGoal).not.toHaveBeenCalled()
    })

    it('should partition successes and failures', async () => {
        mockTodoistApi.linkTaskToGoal
            .mockResolvedValueOnce(undefined as never)
            .mockRejectedValueOnce(new Error('Task not in workspace'))

        const result = await linkGoalTasks.execute(
            { goalId: 'g-1', taskIds: ['t-1', 't-2'], action: 'link' },
            mockTodoistApi,
        )

        expect(result.structuredContent.processed).toEqual(['t-1'])
        expect(result.structuredContent.failures).toEqual([
            { item: 't-2', error: 'Task not in workspace' },
        ])
    })

    it(`should reject batches larger than ${MAX_TASKS_PER_OPERATION}`, () => {
        const oversized = Array.from({ length: MAX_TASKS_PER_OPERATION + 1 }, (_, i) => `t-${i}`)
        const result = linkGoalTasks.parameters.taskIds.safeParse(oversized)
        expect(result.success).toBe(false)
    })
})
