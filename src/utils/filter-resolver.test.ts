import type { Filter, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { FilterResolver } from './filter-resolver.js'
import { createMockFilter } from './test-helpers.js'

function createMockClient(filters: Filter[] = []): Mocked<TodoistApi> {
    return {
        sync: vi.fn().mockResolvedValue({ filters }),
    } as unknown as Mocked<TodoistApi>
}

const mockTodoistApi = createMockClient()

describe('FilterResolver', () => {
    let resolver: FilterResolver

    beforeEach(() => {
        vi.clearAllMocks()
        resolver = new FilterResolver()
    })

    afterEach(() => {
        vi.restoreAllMocks()
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
        it('should isolate filters and reuse cached data per client', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [
                    createMockFilter({ id: '101', name: 'Focus', query: '@alpha-only' }),
                    createMockFilter({ id: '102', name: 'Alpha Private' }),
                ],
            })
            const otherClient = createMockClient([
                createMockFilter({ id: '201', name: 'Focus', query: '@beta-only' }),
            ])

            await resolver.resolveFilter(mockTodoistApi, '101')
            await expect(resolver.resolveFilter(otherClient, '201')).resolves.toMatchObject({
                filterQuery: '@beta-only',
            })
            await expect(resolver.resolveFilter(mockTodoistApi, 'Focus')).resolves.toMatchObject({
                filterQuery: '@alpha-only',
            })
            await expect(resolver.resolveFilter(otherClient, 'Focus')).resolves.toMatchObject({
                filterQuery: '@beta-only',
            })
            for (const reference of ['102', 'Alpha Private']) {
                await expect(resolver.resolveFilter(otherClient, reference)).rejects.toThrow(
                    `Filter "${reference}" not found.`,
                )
            }

            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(1)
            expect(otherClient.sync).toHaveBeenCalledTimes(1)
        })

        it('should include only caller-owned matches in ambiguous errors', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [
                    createMockFilter({ id: '101', name: 'Board Alpha One' }),
                    createMockFilter({ id: '102', name: 'Board Alpha Two' }),
                ],
            })
            const otherClient = createMockClient([
                createMockFilter({ id: '201', name: 'Board Beta One' }),
                createMockFilter({ id: '202', name: 'Board Beta Two' }),
            ])

            await resolver.resolveFilter(mockTodoistApi, '101')
            await expect(resolver.resolveFilter(otherClient, 'Board')).rejects.toThrow(
                new Error(
                    'Ambiguous filter reference "Board". Multiple filters match:\n' +
                        '  - "Board Beta One" (id: 201)\n' +
                        '  - "Board Beta Two" (id: 202)',
                ),
            )
        })

        it('should expire clients independently and retry a failed refresh', async () => {
            const now = vi.spyOn(Date, 'now').mockReturnValue(0)
            const otherClient = createMockClient()
            otherClient.sync
                .mockResolvedValueOnce({
                    filters: [createMockFilter({ name: 'Focus', query: '@beta-only' })],
                })
                .mockRejectedValueOnce(new Error('Sync failed'))
                .mockResolvedValue({
                    filters: [createMockFilter({ name: 'Focus', query: '@beta-updated' })],
                })
            mockTodoistApi.sync.mockResolvedValue({
                filters: [createMockFilter({ name: 'Focus', query: '@alpha-only' })],
            })

            await resolver.resolveFilter(otherClient, 'Focus')
            now.mockReturnValue(60_000)
            await resolver.resolveFilter(mockTodoistApi, 'Focus')

            now.mockReturnValue(5 * 60 * 1000)
            await expect(resolver.resolveFilter(otherClient, 'Focus')).rejects.toThrow(
                'Sync failed',
            )
            await expect(resolver.resolveFilter(otherClient, 'Focus')).resolves.toMatchObject({
                filterQuery: '@beta-updated',
            })
            await expect(resolver.resolveFilter(mockTodoistApi, 'Focus')).resolves.toMatchObject({
                filterQuery: '@alpha-only',
            })
            expect(otherClient.sync).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(1)
        })

        it('should re-fetch all clients after clearCache', async () => {
            mockTodoistApi.sync.mockResolvedValue({
                filters: [createMockFilter({ id: 'f1', name: 'Work', query: '##Work' })],
            })
            const otherClient = createMockClient([createMockFilter({ id: 'f2', name: 'Personal' })])

            await resolver.resolveFilter(mockTodoistApi, 'Work')
            await resolver.resolveFilter(otherClient, 'Personal')
            resolver.clearCache()
            await resolver.resolveFilter(mockTodoistApi, 'Work')
            await resolver.resolveFilter(otherClient, 'Personal')

            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(2)
            expect(otherClient.sync).toHaveBeenCalledTimes(2)
        })

        it('should not let a pre-clear sync overwrite the new cache', async () => {
            let resolveSync: (value: { filters: Filter[] }) => void = () => undefined
            mockTodoistApi.sync
                .mockReturnValueOnce(
                    new Promise<{ filters: Filter[] }>((resolve) => {
                        resolveSync = resolve
                    }),
                )
                .mockResolvedValue({
                    filters: [createMockFilter({ name: 'Focus', query: '@updated' })],
                })

            const pending = resolver.resolveFilter(mockTodoistApi, 'Focus')
            resolver.clearCache()
            await resolver.resolveFilter(mockTodoistApi, 'Focus')

            resolveSync({ filters: [createMockFilter({ name: 'Focus', query: '@old' })] })
            await expect(pending).resolves.toMatchObject({ filterQuery: '@old' })
            await expect(resolver.resolveFilter(mockTodoistApi, 'Focus')).resolves.toMatchObject({
                filterQuery: '@updated',
            })
            expect(mockTodoistApi.sync).toHaveBeenCalledTimes(2)
        })
    })
})
