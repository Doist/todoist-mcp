import type { Filter, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { findFilters } from './find-filters.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_FILTERS } = ToolNames

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

describe(`${FIND_FILTERS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('listing all filters', () => {
        it('should return all filters sorted by itemOrder', async () => {
            const mockFilters: Filter[] = [
                createMockFilter({ id: 'f-2', name: 'Work Filter', query: '#Work', itemOrder: 2 }),
                createMockFilter({
                    id: 'f-1',
                    name: 'Today Filter',
                    query: 'today',
                    itemOrder: 1,
                    isFavorite: true,
                }),
                createMockFilter({
                    id: 'f-3',
                    name: 'Priority Filter',
                    query: 'p1',
                    itemOrder: 3,
                }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(mockTodoistApi.sync).toHaveBeenCalledWith({
                resourceTypes: ['filters'],
                syncToken: '*',
            })

            expect(result.structuredContent.totalCount).toBe(3)
            // Should be sorted by itemOrder
            expect(result.structuredContent.filters[0]?.id).toBe('f-1')
            expect(result.structuredContent.filters[1]?.id).toBe('f-2')
            expect(result.structuredContent.filters[2]?.id).toBe('f-3')
        })

        it('should exclude deleted filters', async () => {
            const mockFilters: Filter[] = [
                createMockFilter({ id: 'f-1', name: 'Active Filter', isDeleted: false }),
                createMockFilter({ id: 'f-2', name: 'Deleted Filter', isDeleted: true }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.filters[0]?.id).toBe('f-1')
        })

        it('should handle empty filters list', async () => {
            mockTodoistApi.sync.mockResolvedValue({ filters: [] })

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.structuredContent.filters).toHaveLength(0)
            expect(result.textContent).toContain('0 found')
        })

        it('should handle missing filters in sync response', async () => {
            mockTodoistApi.sync.mockResolvedValue({})

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(result.structuredContent.totalCount).toBe(0)
        })

        it('should include favorite indicator in text output', async () => {
            const mockFilters: Filter[] = [
                createMockFilter({ id: 'f-1', name: 'Favorite', isFavorite: true, itemOrder: 1 }),
                createMockFilter({ id: 'f-2', name: 'Regular', isFavorite: false, itemOrder: 2 }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(result.textContent).toContain('Favorite ★')
            expect(result.textContent).not.toContain('Regular ★')
        })
    })

    describe('searching filters', () => {
        it('should filter by name (case insensitive)', async () => {
            const mockFilters: Filter[] = [
                createMockFilter({ id: 'f-1', name: 'Work Tasks', query: '#Work', itemOrder: 1 }),
                createMockFilter({
                    id: 'f-2',
                    name: 'Personal Tasks',
                    query: '#Personal',
                    itemOrder: 2,
                }),
                createMockFilter({ id: 'f-3', name: 'Today', query: 'today', itemOrder: 3 }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({ search: 'TASKS' }, mockTodoistApi)

            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.structuredContent.filters.map((f) => f.id)).toEqual(['f-1', 'f-2'])
        })

        it('should return empty when no filters match search', async () => {
            const mockFilters: Filter[] = [createMockFilter({ name: 'Work Filter', itemOrder: 1 })]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({ search: 'nonexistent' }, mockTodoistApi)

            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.textContent).toContain('0 found')
        })

        it('should show filter query in text output', async () => {
            const mockFilters: Filter[] = [
                createMockFilter({
                    id: 'f-1',
                    name: 'Today High Priority',
                    query: 'today & p1',
                    itemOrder: 1,
                }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(result.textContent).toContain('today & p1')
        })
    })

    describe('structured content', () => {
        it('should return correct filter fields', async () => {
            const mockFilters: Filter[] = [
                createMockFilter({
                    id: 'f-1',
                    name: 'My Filter',
                    query: 'today & p1',
                    color: 'blue',
                    isFavorite: true,
                    itemOrder: 5,
                }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(result.structuredContent.filters[0]).toEqual(
                expect.objectContaining({
                    id: 'f-1',
                    name: 'My Filter',
                    query: 'today & p1',
                    color: 'blue',
                    isFavorite: true,
                    itemOrder: 5,
                }),
            )
        })

        it('should handle unrecognized color values gracefully', async () => {
            const mockFilters: Filter[] = [
                createMockFilter({ id: 'f-1', color: 'unknown-color-xyz', itemOrder: 1 }),
            ]
            mockTodoistApi.sync.mockResolvedValue({ filters: mockFilters })

            const result = await findFilters.execute({}, mockTodoistApi)

            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.filters[0]?.color).toBeUndefined()
        })
    })

    describe('error handling', () => {
        it('should propagate API errors', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            await expect(findFilters.execute({}, mockTodoistApi)).rejects.toThrow(
                TEST_ERRORS.API_UNAUTHORIZED,
            )
        })
    })
})
