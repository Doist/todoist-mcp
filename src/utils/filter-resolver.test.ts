import type { Filter, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { FilterResolver } from './filter-resolver.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

function createMockFilter(overrides: Partial<Filter> = {}): Filter {
    return {
        id: 'filter-1',
        name: 'Test Filter',
        query: 'today',
        color: 'charcoal',
        isDeleted: false,
        isFavorite: false,
        isFrozen: false,
        itemOrder: 0,
        ...overrides,
    }
}

describe('FilterResolver', () => {
    let resolver: FilterResolver

    beforeEach(() => {
        vi.clearAllMocks()
        resolver = new FilterResolver()
    })

    describe('resolveFilter', () => {
        it('should resolve by exact ID', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [
                    createMockFilter({ id: 'f1', name: 'Work Tasks', query: '##Work' }),
                    createMockFilter({ id: 'f2', name: 'Urgent', query: 'p1' }),
                ],
            })

            const result = await resolver.resolveFilter(mockTodoistApi, 'f1')
            expect(result).toEqual({
                filterId: 'f1',
                filterName: 'Work Tasks',
                filterQuery: '##Work',
            })
        })

        it('should resolve by exact case-insensitive name', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [
                    createMockFilter({ id: 'f1', name: 'Work Tasks', query: '##Work' }),
                    createMockFilter({ id: 'f2', name: 'Urgent Items', query: 'p1' }),
                ],
            })

            const result = await resolver.resolveFilter(mockTodoistApi, 'work tasks')
            expect(result).toEqual({
                filterId: 'f1',
                filterName: 'Work Tasks',
                filterQuery: '##Work',
            })
        })

        it('should resolve by unique partial name match', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [
                    createMockFilter({ id: 'f1', name: 'Work Tasks', query: '##Work' }),
                    createMockFilter({ id: 'f2', name: 'Urgent Items', query: 'p1' }),
                ],
            })

            const result = await resolver.resolveFilter(mockTodoistApi, 'Urgent')
            expect(result).toEqual({
                filterId: 'f2',
                filterName: 'Urgent Items',
                filterQuery: 'p1',
            })
        })

        it('should throw on ambiguous partial name match', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [
                    createMockFilter({ id: 'f1', name: 'Work Tasks', query: '##Work' }),
                    createMockFilter({ id: 'f2', name: 'Work Urgent', query: 'p1' }),
                ],
            })

            await expect(resolver.resolveFilter(mockTodoistApi, 'Work')).rejects.toThrow(
                /Ambiguous filter reference "Work"/,
            )
        })

        it('should throw when filter not found', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [createMockFilter({ id: 'f1', name: 'Work Tasks', query: '##Work' })],
            })

            await expect(resolver.resolveFilter(mockTodoistApi, 'Nonexistent')).rejects.toThrow(
                'Filter "Nonexistent" not found.',
            )
        })

        it('should throw on empty input', async () => {
            await expect(resolver.resolveFilter(mockTodoistApi, '')).rejects.toThrow(
                'Filter reference cannot be empty',
            )
            await expect(resolver.resolveFilter(mockTodoistApi, '   ')).rejects.toThrow(
                'Filter reference cannot be empty',
            )
        })

        it('should exclude deleted filters', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [
                    createMockFilter({
                        id: 'f1',
                        name: 'Deleted Filter',
                        query: 'today',
                        isDeleted: true,
                    }),
                ],
            })

            await expect(resolver.resolveFilter(mockTodoistApi, 'f1')).rejects.toThrow(
                'Filter "f1" not found.',
            )
        })

        it('should handle empty filters array from sync', async () => {
            mockTodoistApi.sync.mockResolvedValue({})

            await expect(resolver.resolveFilter(mockTodoistApi, 'any')).rejects.toThrow(
                'Filter "any" not found.',
            )
        })

        it('should list up to 5 matches in ambiguous error', async () => {
            const filters = Array.from({ length: 7 }, (_, i) =>
                createMockFilter({ id: `f${i}`, name: `Filter ${i}`, query: `q${i}` }),
            )
            mockTodoistApi.sync.mockResolvedValue({ filters })

            await expect(resolver.resolveFilter(mockTodoistApi, 'Filter')).rejects.toThrow(
                /and 2 more/,
            )
        })
    })

    describe('caching', () => {
        it('should not re-fetch filters on second call', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [createMockFilter({ id: 'f1', name: 'Work', query: '##Work' })],
            })

            await resolver.resolveFilter(mockTodoistApi, 'Work')
            await resolver.resolveFilter(mockTodoistApi, 'Work')

            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(1)
        })

        it('should re-fetch after clearCache', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [createMockFilter({ id: 'f1', name: 'Work', query: '##Work' })],
            })

            await resolver.resolveFilter(mockTodoistApi, 'Work')
            resolver.clearCache()
            await resolver.resolveFilter(mockTodoistApi, 'Work')

            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(2)
        })
    })
})
