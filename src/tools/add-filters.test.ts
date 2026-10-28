import { type Filter, type TodoistApi, TodoistSyncError } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { allApplied, TEST_ERRORS } from '../utils/test-helpers.js'
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
                    syncStatus: allApplied(commands),
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
                return {
                    filters: createdFilters,
                    tempIdMapping: tempIdMap,
                    syncStatus: allApplied(commands),
                }
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

    describe('descriptions', () => {
        function mockCreateEchoingDescription() {
            mockTodoistApi.sync.mockImplementation(async (request) => {
                const commands = request.commands ?? []
                const tempIdMap: Record<string, string> = {}
                const createdFilters: Filter[] = []
                for (const cmd of commands) {
                    if (cmd.type === 'filter_add' && cmd.tempId) {
                        const newId = 'filter-described'
                        tempIdMap[cmd.tempId] = newId
                        createdFilters.push(
                            createMockFilter({
                                id: newId,
                                name: cmd.args.name as string,
                                query: cmd.args.query as string,
                                // Echo back whatever the command carried, the way the API would.
                                description: cmd.args.description as string | undefined,
                            }),
                        )
                    }
                }
                return {
                    filters: createdFilters,
                    tempIdMapping: tempIdMap,
                    syncStatus: allApplied(commands),
                }
            })
        }

        it('sends the description and echoes it back', async () => {
            mockCreateEchoingDescription()

            const result = await addFilters.execute(
                {
                    filters: [
                        {
                            name: 'Day job',
                            query: 'today & #Work',
                            description: 'Everything for the day job',
                        },
                    ],
                },
                mockTodoistApi,
            )

            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands?.[0]?.args).toMatchObject({
                description: 'Everything for the day job',
            })
            expect(result.structuredContent.filters[0]?.description).toBe(
                'Everything for the day job',
            )
        })

        it('leaves the key out of the command and the output when there is no description', async () => {
            mockCreateEchoingDescription()

            const result = await addFilters.execute(
                { filters: [{ name: 'Day job', query: 'today & #Work' }] },
                mockTodoistApi,
            )

            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands?.[0]?.args).not.toHaveProperty('description')
            expect(result.structuredContent.filters[0]).not.toHaveProperty('description')
        })

        it('drops an empty description rather than sending one', async () => {
            mockCreateEchoingDescription()

            // The schema normalizes "" to undefined, so the key never reaches the command.
            // LLMs send "" for omitted optional fields and the API rejects that.
            const parsed = z.object(addFilters.parameters).parse({
                filters: [{ name: 'Day job', query: 'today & #Work', description: '' }],
            })
            const result = await addFilters.execute(parsed, mockTodoistApi)

            const syncCall = mockTodoistApi.sync.mock.calls[0]?.[0]
            expect(syncCall?.commands?.[0]?.args).not.toHaveProperty('description')
            expect(result.structuredContent.filters[0]).not.toHaveProperty('description')
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
                return {
                    filters: createdFilters,
                    tempIdMapping: tempIdMap,
                    syncStatus: allApplied(commands),
                }
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
        it('reports every filter as failed when the request itself fails', async () => {
            mockTodoistApi.sync.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            const result = await addFilters.execute(
                { filters: [{ name: 'Test', query: 'today' }] },
                mockTodoistApi,
            )

            expect(result.structuredContent.filters).toEqual([])
            expect(result.structuredContent.failures).toEqual([
                { item: 'Test', error: TEST_ERRORS.API_UNAUTHORIZED },
            ])
            expect(result.textContent).toContain('Added 0 filters')
        })

        it('keeps the created filters when one command in the batch fails', async () => {
            mockTodoistApi.sync.mockImplementation(async (request) => {
                const [created, rejected] = request.commands ?? []
                throw new TodoistSyncError(
                    {
                        error: 'Invalid argument value',
                        errorCode: 20,
                        errorExtra: { argument: 'query' },
                        errorTag: 'INVALID_ARGUMENT_VALUE',
                        httpCode: 400,
                    },
                    {
                        syncStatus: {
                            [created?.uuid ?? '']: 'ok',
                            [rejected?.uuid ?? '']: {
                                error: 'Invalid argument value',
                                errorCode: 20,
                                errorExtra: { argument: 'query' },
                                errorTag: 'INVALID_ARGUMENT_VALUE',
                                httpCode: 400,
                            },
                        },
                        tempIdMapping: { [created?.tempId ?? '']: 'filter-1' },
                    },
                )
            })

            const result = await addFilters.execute(
                {
                    filters: [
                        { name: 'Works', query: 'today' },
                        { name: 'Broken', query: '((' },
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent } = result
            expect(structuredContent.filters.map((filter) => filter.id)).toEqual(['filter-1'])
            expect(structuredContent.totalRequested).toBe(2)
            expect(structuredContent.successCount).toBe(1)
            expect(structuredContent.failureCount).toBe(1)
            expect(structuredContent.failures).toEqual([
                {
                    item: 'Broken',
                    error: 'Invalid argument value (HTTP 400, code 20, tag INVALID_ARGUMENT_VALUE)',
                },
            ])
            expect(result.textContent).toContain('Added 1 filter:')
            expect(result.textContent).toContain('Failed (1) - address or drop these items')
        })

        it('reports a filter as failed when Todoist applied it but returned no ID', async () => {
            mockTodoistApi.sync.mockImplementation(async (request) => ({
                tempIdMapping: {},
                syncStatus: allApplied(request.commands),
            }))

            const result = await addFilters.execute(
                { filters: [{ name: 'Lost', query: 'today' }] },
                mockTodoistApi,
            )

            expect(result.structuredContent.filters).toEqual([])
            expect(result.structuredContent.failures).toEqual([
                { item: 'Lost', error: 'Todoist did not return an ID for the created filter' },
            ])
        })

        it('retries a transient 5xx failure of the request', async () => {
            vi.useFakeTimers()
            try {
                mockTodoistApi.sync
                    .mockRejectedValueOnce(
                        Object.assign(new Error('Service Unavailable'), { httpStatusCode: 503 }),
                    )
                    .mockImplementationOnce(async (request) => {
                        const commands = request.commands ?? []
                        return {
                            tempIdMapping: { [commands[0]?.tempId ?? '']: 'filter-1' },
                            syncStatus: allApplied(commands),
                        }
                    })

                const promise = addFilters.execute(
                    { filters: [{ name: 'Test', query: 'today' }] },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.sync).toHaveBeenCalledTimes(2)
                // The retry resends the same commands, so the Sync API can skip any
                // it already applied.
                expect(mockTodoistApi.sync.mock.calls[1]?.[0].commands).toEqual(
                    mockTodoistApi.sync.mock.calls[0]?.[0].commands,
                )
                expect(result.structuredContent.successCount).toBe(1)
            } finally {
                vi.useRealTimers()
            }
        })
    })
})
