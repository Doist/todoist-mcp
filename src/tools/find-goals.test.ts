import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { createMockApiResponse, createMockGoal } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { findGoals } from './find-goals.js'

const mockTodoistApi = {
    getGoals: vi.fn(),
    searchGoals: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_GOALS } = ToolNames

describe(`${FIND_GOALS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('listing all goals', () => {
        it('should list all goals when no search text is provided', async () => {
            const goals = [
                createMockGoal({ id: 'g-1', name: 'Ship MCP' }),
                createMockGoal({ id: 'g-2', name: 'Hire eng' }),
            ]
            mockTodoistApi.getGoals.mockResolvedValue(createMockApiResponse(goals))

            const result = await findGoals.execute({ limit: 50 }, mockTodoistApi)

            expect(mockTodoistApi.getGoals).toHaveBeenCalledWith({
                ownerType: undefined,
                cursor: null,
                limit: 50,
            })
            expect(mockTodoistApi.searchGoals).not.toHaveBeenCalled()

            const { structuredContent } = result
            expect(structuredContent.goals).toHaveLength(2)
            expect(structuredContent.totalCount).toBe(2)
            expect(structuredContent.hasMore).toBe(false)
            expect(structuredContent.nextCursor).toBeUndefined()
            expect(structuredContent.goals[0]).toMatchObject({ id: 'g-1', name: 'Ship MCP' })
        })

        it('should pass ownerType filter through', async () => {
            mockTodoistApi.getGoals.mockResolvedValue(createMockApiResponse([]))

            await findGoals.execute({ limit: 50, ownerType: 'WORKSPACE' }, mockTodoistApi)

            expect(mockTodoistApi.getGoals).toHaveBeenCalledWith({
                ownerType: 'WORKSPACE',
                cursor: null,
                limit: 50,
            })
        })

        it('should expose pagination cursor when results are paginated', async () => {
            mockTodoistApi.getGoals.mockResolvedValue(
                createMockApiResponse([createMockGoal()], 'next-page-cursor'),
            )

            const result = await findGoals.execute(
                { limit: 10, cursor: 'current-page' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getGoals).toHaveBeenCalledWith({
                ownerType: undefined,
                cursor: 'current-page',
                limit: 10,
            })
            expect(result.structuredContent.nextCursor).toBe('next-page-cursor')
            expect(result.structuredContent.hasMore).toBe(true)
        })
    })

    describe('searching goals', () => {
        it('should call searchGoals when searchText is provided', async () => {
            mockTodoistApi.searchGoals.mockResolvedValue(
                createMockApiResponse([createMockGoal({ name: 'Ship MCP' })]),
            )

            const result = await findGoals.execute(
                { limit: 50, searchText: 'ship' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.searchGoals).toHaveBeenCalledWith({
                query: 'ship',
                ownerType: undefined,
                cursor: null,
                limit: 50,
            })
            expect(mockTodoistApi.getGoals).not.toHaveBeenCalled()
            expect(result.structuredContent.goals).toHaveLength(1)
        })

        it('should forward cursor on subsequent search pages', async () => {
            mockTodoistApi.searchGoals.mockResolvedValue(createMockApiResponse([], 'cursor-2'))

            await findGoals.execute(
                { limit: 25, searchText: 'ship', cursor: 'cursor-1' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.searchGoals).toHaveBeenCalledWith({
                query: 'ship',
                ownerType: undefined,
                cursor: 'cursor-1',
                limit: 25,
            })
        })
    })

    describe('mapping output', () => {
        it('should drop null description/deadline/responsibleUid from output', async () => {
            mockTodoistApi.getGoals.mockResolvedValue(
                createMockApiResponse([
                    createMockGoal({
                        description: null,
                        deadline: null,
                        responsibleUid: null,
                    }),
                ]),
            )

            const result = await findGoals.execute({ limit: 50 }, mockTodoistApi)

            const [goal] = result.structuredContent.goals
            expect(goal?.description).toBeUndefined()
            expect(goal?.deadline).toBeUndefined()
            expect(goal?.responsibleUid).toBeUndefined()
        })

        it('should preserve description/deadline/responsibleUid when present', async () => {
            mockTodoistApi.getGoals.mockResolvedValue(
                createMockApiResponse([
                    createMockGoal({
                        description: 'Quarterly target',
                        deadline: '2026-12-31',
                        responsibleUid: 'user-42',
                    }),
                ]),
            )

            const result = await findGoals.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.goals[0]).toMatchObject({
                description: 'Quarterly target',
                deadline: '2026-12-31',
                responsibleUid: 'user-42',
            })
        })
    })
})
