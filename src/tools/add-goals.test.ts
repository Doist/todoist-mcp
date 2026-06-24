import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { createMockGoal } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { addGoals, MAX_GOALS_PER_OPERATION } from './add-goals.js'

const mockTodoistApi = {
    addGoal: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_GOALS } = ToolNames

describe(`${ADD_GOALS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should create a single personal goal', async () => {
        mockTodoistApi.addGoal.mockResolvedValue(createMockGoal({ id: 'new-1', name: 'Ship MCP' }))

        const result = await addGoals.execute({ goals: [{ name: 'Ship MCP' }] }, mockTodoistApi)

        expect(mockTodoistApi.addGoal).toHaveBeenCalledTimes(1)
        expect(mockTodoistApi.addGoal).toHaveBeenCalledWith({ name: 'Ship MCP' })
        expect(result.structuredContent.totalCount).toBe(1)
        expect(result.structuredContent.goals[0]).toMatchObject({ id: 'new-1', name: 'Ship MCP' })
        expect(result.textContent).toContain('Added 1 goal')
    })

    it('should create multiple goals concurrently', async () => {
        mockTodoistApi.addGoal
            .mockResolvedValueOnce(createMockGoal({ id: 'g-1', name: 'A' }))
            .mockResolvedValueOnce(createMockGoal({ id: 'g-2', name: 'B' }))

        const result = await addGoals.execute(
            { goals: [{ name: 'A' }, { name: 'B' }] },
            mockTodoistApi,
        )

        expect(mockTodoistApi.addGoal).toHaveBeenCalledTimes(2)
        expect(result.structuredContent.totalCount).toBe(2)
        expect(result.textContent).toContain('Added 2 goals')
    })

    it('should pass workspaceId and optional fields to the SDK', async () => {
        mockTodoistApi.addGoal.mockResolvedValue(
            createMockGoal({ ownerType: 'WORKSPACE', ownerId: 'ws-1' }),
        )

        await addGoals.execute(
            {
                goals: [
                    {
                        name: 'Workspace goal',
                        workspaceId: 'ws-1',
                        description: 'desc',
                        deadline: '2026-12-31',
                        responsibleUid: 'user-1',
                    },
                ],
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.addGoal).toHaveBeenCalledWith({
            name: 'Workspace goal',
            workspaceId: 'ws-1',
            description: 'desc',
            deadline: '2026-12-31',
            responsibleUid: 'user-1',
        })
    })

    it('should reject empty batches at schema-validation time', () => {
        const result = addGoals.parameters.goals.safeParse([])
        expect(result.success).toBe(false)
    })

    it(`should reject batches larger than ${MAX_GOALS_PER_OPERATION}`, () => {
        const oversized = Array.from({ length: MAX_GOALS_PER_OPERATION + 1 }, () => ({
            name: 'x',
        }))
        const result = addGoals.parameters.goals.safeParse(oversized)
        expect(result.success).toBe(false)
    })
})
