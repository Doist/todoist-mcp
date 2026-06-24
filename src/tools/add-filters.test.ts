import type { Filter, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { addFilters } from './add-filters.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_FILTERS } = ToolNames

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

describe(`${ADD_FILTERS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('adding a single filter', () => {
        it('should add a filter and return its data', async () => {
            const tempIdMapping: Record<string, string> = {}
            // We don't know the exact tempId ahead of time, so we'll use a flexible setup
            mockTodoistApi.sync.mockImplementation(async (request) => {
                const commands = request.commands ?? []
                const createdFilters: Filter[] = []
                for (const cmd of commands) {
                    if (cmd.type === 'filter_add' && cmd.tempId) {
                        const newId = `real-filter-${Math.random()}`
                        tempIdMapping[cmd.tempId] = newId
                        createdFilters.push(
                            createMockFilter({
                                id: newId,
                                name: cmd.args.name as string,
                                query: cmd.args.query as string,
                                isFavorite: (cmd.args.isFavorite as boolean) ?? false,
                                itemOrder: 1,
                            }),
                        )
                    }
                }
                return {
                    filters: createdFilters,
                    tempIdMapping,
                    syncStatus: Object.fromEntries(commands.map((c) => [c.uuid, 'ok' as const])),
                }
            })

            const result = await addFilters.execute(
                {
                    filters: [{ name: 'Today Priority', query: 'today & p1' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledOnce()
            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands).toHaveLength(1)
            expect(syncCall?.commands?.[0]?.type).toBe('filter_add')
            expect(syncCall?.commands?.[0]?.args).toMatchObject({
                name: 'Today Priority',
                query: 'today & p1',
            })
            expect(syncCall?.resourceTypes).toBeUndefined()

            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.filters[0]).toMatchObject({
                name: 'Today Priority',
                query: 'today & p1',
            })
            expect(result.textContent).toContain('Added 1 filter')
        })

        it('should add a filter with all optional fields', async () => {
            mockTodoistApi.sync.mockImplementation(async (request) => {
                const commands = request.commands ?? []
                const tempIdMap: Record<string, string> = {}
                const createdFilters: Filter[] = []
                for (const cmd of commands) {
                    if (cmd.type === 'filter_add' && cmd.tempId) {
                        const newId = 'filter-with-options'
                        tempIdMap[cmd.tempId] = newId
                        createdFilters.push(
                            createMockFilter({
                                id: newId,
                                name: cmd.args.name as string,
                                query: cmd.args.query as string,
                                color: cmd.args.color as string,
                                isFavorite: true,
                                itemOrder: 1,
                            }),
                        )
                    }
                }
                return { filters: createdFilters, tempIdMapping: tempIdMap }
            })

            const result = await addFilters.execute(
                {
                    filters: [
                        {
                            name: 'Favorite Work Filter',
                            query: '#Work & today',
                            color: 'blue',
                            isFavorite: true,
                        },
                    ],
                },
                mockTodoistApi,
            )

            const syncArgs = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncArgs?.commands?.[0]?.args).toMatchObject({
                name: 'Favorite Work Filter',
                query: '#Work & today',
                color: 'blue',
                isFavorite: true,
            })

            expect(result.structuredContent.filters[0]?.isFavorite).toBe(true)
        })
    })

    describe('adding multiple filters', () => {
        it('should add multiple filters in batch', async () => {
            mockTodoistApi.sync.mockImplementation(async (request) => {
                const commands = request.commands ?? []
                const tempIdMap: Record<string, string> = {}
                const createdFilters: Filter[] = []
                let order = 1
                for (const cmd of commands) {
                    if (cmd.type === 'filter_add' && cmd.tempId) {
                        const newId = `filter-${order}`
                        tempIdMap[cmd.tempId] = newId
                        createdFilters.push(
                            createMockFilter({
                                id: newId,
                                name: cmd.args.name as string,
                                query: cmd.args.query as string,
                                itemOrder: order++,
                            }),
                        )
                    }
                }
                return { filters: createdFilters, tempIdMapping: tempIdMap }
            })

            const result = await addFilters.execute(
                {
                    filters: [
                        { name: 'Filter A', query: 'today' },
                        { name: 'Filter B', query: 'overdue' },
                        { name: 'Filter C', query: 'p1' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).toHaveBeenCalledOnce()
            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands).toHaveLength(3)

            expect(result.structuredContent.totalCount).toBe(3)
            expect(result.textContent).toContain('Added 3 filters')
        })
    })

    describe('error handling', () => {
        it('should propagate API errors', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            await expect(
                addFilters.execute({ filters: [{ name: 'Test', query: 'today' }] }, mockTodoistApi),
            ).rejects.toThrow(TEST_ERRORS.API_UNAUTHORIZED)
        })
    })
})
