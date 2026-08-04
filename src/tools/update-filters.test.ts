import type { Filter, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { updateFilters } from './update-filters.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_FILTERS } = ToolNames

function createMockFilter(overrides: Partial<Filter> = {}): Filter {
    return {
        id: 'filter-1',
        name: 'Test Filter',
        query: 'today',
        color: 'blue',
        isDeleted: false,
        isFavorite: false,
        isFrozen: false,
        itemOrder: 1,
        ...overrides,
    }
}

describe(`${UPDATE_FILTERS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('updating a single filter', () => {
        it('should update a filter name', async () => {
            const updatedFilter = createMockFilter({
                id: 'filter-1',
                name: 'Updated Name',
                query: 'today',
            })
            mockTodoistApi.sync.mockResolvedValue({ filters: [updatedFilter] })

            const result = await updateFilters.execute(
                { filters: [{ id: 'filter-1', name: 'Updated Name' }] },
                mockTodoistApi,
            )

            // update-filters makes 2 sync calls: command first, then read-back
            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(2)
            const commandCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(commandCall?.commands?.[0]?.type).toBe('filter_update')
            expect(commandCall?.commands?.[0]?.args).toMatchObject({
                id: 'filter-1',
                name: 'Updated Name',
            })

            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.updatedFilterIds).toContain('filter-1')
            expect(result.textContent).toContain('Updated 1 filter')
        })

        it('should update a filter query', async () => {
            const updatedFilter = createMockFilter({
                id: 'filter-1',
                query: 'today & p1',
            })
            mockTodoistApi.sync.mockResolvedValue({ filters: [updatedFilter] })

            const result = await updateFilters.execute(
                { filters: [{ id: 'filter-1', query: 'today & p1' }] },
                mockTodoistApi,
            )

            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands?.[0]?.args).toMatchObject({
                id: 'filter-1',
                query: 'today & p1',
            })

            expect(result.structuredContent.totalCount).toBe(1)
        })

        it('should update isFavorite status', async () => {
            const updatedFilter = createMockFilter({ id: 'filter-1', isFavorite: true })
            mockTodoistApi.sync.mockResolvedValue({ filters: [updatedFilter] })

            await updateFilters.execute(
                { filters: [{ id: 'filter-1', isFavorite: true }] },
                mockTodoistApi,
            )

            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands?.[0]?.args).toMatchObject({
                id: 'filter-1',
                isFavorite: true,
            })
        })
    })

    describe('skipping filters with no changes', () => {
        it('should skip filters with no update fields', async () => {
            const result = await updateFilters.execute(
                { filters: [{ id: 'filter-1' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).not.toHaveBeenCalled()
            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.structuredContent.appliedOperations.skippedCount).toBe(1)
            expect(result.textContent).toContain('0 filters')
            expect(result.textContent).toContain('1 skipped')
        })
    })

    describe('updating multiple filters', () => {
        it('should update multiple filters in batch', async () => {
            const updatedFilters: Filter[] = [
                createMockFilter({ id: 'filter-1', name: 'New Name 1' }),
                createMockFilter({ id: 'filter-2', name: 'New Name 2', itemOrder: 2 }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: updatedFilters })

            const result = await updateFilters.execute(
                {
                    filters: [
                        { id: 'filter-1', name: 'New Name 1' },
                        { id: 'filter-2', name: 'New Name 2' },
                    ],
                },
                mockTodoistApi,
            )

            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands).toHaveLength(2)
            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.structuredContent.appliedOperations.updateCount).toBe(2)
            expect(result.structuredContent.appliedOperations.skippedCount).toBe(0)
            expect(result.textContent).toContain('Updated 2 filters')
        })

        it('should mix updated and skipped filters', async () => {
            const updatedFilter = createMockFilter({ id: 'filter-1', name: 'Updated' })
            mockTodoistApi.sync.mockResolvedValue({ filters: [updatedFilter] })

            const result = await updateFilters.execute(
                {
                    filters: [
                        { id: 'filter-1', name: 'Updated' },
                        { id: 'filter-2' }, // no fields → should be skipped
                    ],
                },
                mockTodoistApi,
            )

            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands).toHaveLength(1)
            expect(result.structuredContent.appliedOperations.updateCount).toBe(1)
            expect(result.structuredContent.appliedOperations.skippedCount).toBe(1)
        })
    })

    describe('error handling', () => {
        it('should propagate API errors', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            await expect(
                updateFilters.execute(
                    { filters: [{ id: 'filter-1', name: 'Updated' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(TEST_ERRORS.API_UNAUTHORIZED)
        })
    })
})
