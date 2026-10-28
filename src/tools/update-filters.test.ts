import { type Filter, type TodoistApi, TodoistSyncError } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
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

/**
 * Answers the update request with an applied status for every command, and the
 * read-back with `filters`.
 */
function mockSync(filters: Filter[]) {
    mockTodoistApi.sync.mockImplementation(async (request) => ({
        filters,
        syncStatus: Object.fromEntries(
            (request.commands ?? []).map((command) => [command.uuid, 'ok' as const]),
        ),
    }))
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
            mockSync([updatedFilter])

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
            mockSync([updatedFilter])

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

        it('should update a filter description', async () => {
            const updatedFilter = createMockFilter({ id: 'filter-1' })
            mockSync([updatedFilter])

            await updateFilters.execute(
                { filters: [{ id: 'filter-1', description: 'Everything due this week' }] },
                mockTodoistApi,
            )

            const commandCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(commandCall?.commands?.[0]?.args).toMatchObject({
                id: 'filter-1',
                description: 'Everything due this week',
            })
        })

        it('accepts a legacy null as the clear sentinel', () => {
            // Callers that predate the "remove" sentinel clear optional fields with null.
            // The schema turns it into the sentinel so those calls keep working, and the
            // command builder then sends the null the API expects.
            const parsed = z.object(updateFilters.parameters).parse({
                filters: [{ id: 'filter-1', description: null }],
            })

            expect(parsed.filters[0]?.description).toBe('remove')
        })

        it('should clear a description when passed "remove"', async () => {
            const updatedFilter = createMockFilter({ id: 'filter-1' })
            mockSync([updatedFilter])

            await updateFilters.execute(
                { filters: [{ id: 'filter-1', description: 'remove' }] },
                mockTodoistApi,
            )

            // The sentinel becomes null, which is what the API reads as "clear it".
            const commandCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(commandCall?.commands?.[0]?.args).toMatchObject({
                id: 'filter-1',
                description: null,
            })
        })

        it('should update isFavorite status', async () => {
            const updatedFilter = createMockFilter({ id: 'filter-1', isFavorite: true })
            mockSync([updatedFilter])

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
            mockSync(updatedFilters)

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
            mockSync([updatedFilter])

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
        it('reports every filter as failed when the update request itself fails', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            const result = await updateFilters.execute(
                { filters: [{ id: 'filter-1', name: 'Updated' }] },
                mockTodoistApi,
            )

            // Nothing was applied, so there is nothing to read back.
            expect(mockTodoistApi.sync).toHaveBeenCalledOnce()
            expect(result.structuredContent.updatedFilterIds).toEqual([])
            expect(result.structuredContent.failures).toEqual([
                { item: 'filter-1', error: TEST_ERRORS.API_UNAUTHORIZED },
            ])
            expect(result.structuredContent.appliedOperations.failureCount).toBe(1)
        })

        it('keeps the updated filters when one command in the batch fails', async () => {
            const commandError = {
                error: 'Filter not found',
                errorCode: 23,
                errorExtra: {},
                errorTag: 'NOT_FOUND',
                httpCode: 404,
            }
            mockTodoistApi.sync
                .mockImplementationOnce(async (request) => {
                    const [updated, missing] = request.commands ?? []
                    throw new TodoistSyncError(commandError, {
                        syncStatus: {
                            [updated?.uuid ?? '']: 'ok',
                            [missing?.uuid ?? '']: commandError,
                        },
                        tempIdMapping: {},
                    })
                })
                .mockResolvedValueOnce({
                    filters: [createMockFilter({ id: 'filter-1', name: 'Renamed' })],
                })

            const result = await updateFilters.execute(
                {
                    filters: [
                        { id: 'filter-1', name: 'Renamed' },
                        { id: 'missing', name: 'Nope' },
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent } = result
            expect(structuredContent.updatedFilterIds).toEqual(['filter-1'])
            expect(structuredContent.filters.map((filter) => filter.name)).toEqual(['Renamed'])
            expect(structuredContent.failures).toEqual([
                {
                    item: 'missing',
                    error: 'Filter not found (HTTP 404, code 23, tag NOT_FOUND)',
                },
            ])
            expect(structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 0,
                failureCount: 1,
            })
            expect(result.textContent).toContain('Failed (1) - address or drop these items')
        })

        it('still reports the applied updates when they cannot be read back', async () => {
            mockTodoistApi.sync
                .mockImplementationOnce(async (request) => ({
                    syncStatus: Object.fromEntries(
                        (request.commands ?? []).map((command) => [command.uuid, 'ok' as const]),
                    ),
                }))
                .mockRejectedValueOnce(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            const result = await updateFilters.execute(
                { filters: [{ id: 'filter-1', name: 'Renamed' }] },
                mockTodoistApi,
            )

            expect(result.structuredContent.updatedFilterIds).toEqual(['filter-1'])
            expect(result.structuredContent.filters).toEqual([])
            expect(result.structuredContent.failures).toEqual([])
            expect(result.textContent).toBe(
                `Updated 1 filter: filter-1\nThe updated filters could not be read back: ${TEST_ERRORS.API_UNAUTHORIZED}`,
            )
        })
    })
})
