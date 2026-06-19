import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, type MockedFunction, vi } from 'vitest'
import { getTasksByFilter, MappedTask } from '../tool-helpers.js'
import { createMappedTask, createMockUser, TEST_ERRORS, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { resolveUserNameToId } from '../utils/user-resolver.js'
import { findTasksByDate } from './find-tasks-by-date.js'

// Mock only getTasksByFilter, use actual implementations for everything else
vi.mock('../tool-helpers', async () => {
    const actual = (await vi.importActual('../tool-helpers')) as typeof import('../tool-helpers.js')
    return {
        ...actual,
        getTasksByFilter: vi.fn(),
    }
})

// Mock user resolver
vi.mock('../utils/user-resolver', () => ({
    resolveUserNameToId: vi.fn(),
}))

const mockGetTasksByFilter = getTasksByFilter as MockedFunction<typeof getTasksByFilter>
const mockResolveUserNameToId = resolveUserNameToId as MockedFunction<typeof resolveUserNameToId>

// Mock the Todoist API (not directly used by find-tasks-by-date, but needed for type)
const mockTodoistApi = {
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

// Mock the Todoist User
const mockTodoistUser = createMockUser()

// Mock date-fns functions to make tests deterministic
// Use local date parsing/formatting to match the production code's timezone-aware behavior
vi.mock('date-fns', () => ({
    addDays: vi.fn((date: string | Date, amount: number) => {
        const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date)
        d.setDate(d.getDate() + amount)
        return d
    }),
    formatISO: vi.fn((date: string | Date, options?: { representation?: string }) => {
        if (typeof date === 'string') {
            return date // Return string dates as-is
        }
        if (options?.representation === 'date') {
            const year = date.getFullYear()
            const month = String(date.getMonth() + 1).padStart(2, '0')
            const day = String(date.getDate()).padStart(2, '0')
            return `${year}-${month}-${day}`
        }
        return date.toISOString()
    }),
}))

const { FIND_TASKS_BY_DATE } = ToolNames

describe(`${FIND_TASKS_BY_DATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getUser.mockResolvedValue(mockTodoistUser)

        // Mock current date to make tests deterministic
        vi.spyOn(Date, 'now').mockReturnValue(new Date('2025-08-15T10:00:00Z').getTime())
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('listing tasks by date range', () => {
        it('only returns tasks for the startDate when daysCount is 1', async () => {
            const mockTasks = [
                createMappedTask({ content: 'Task for specific date', dueDate: '2025-08-20' }),
            ]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 1 },
                mockTodoistApi,
            )

            // Verify the query uses daysCount=1 by checking the end date calculation
            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: '(due after: 2025-08-20 | due: 2025-08-20) & due before: 2025-08-21 & !assigned to: others',
                cursor: undefined,
                limit: 50,
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
        })

        it('should get tasks for today when startDate is "today" with daysCount=1 (includes overdue)', async () => {
            const mockTasks = [createMappedTask({ content: 'Today task', dueDate: '2025-08-15' })]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                { startDate: 'today', limit: 50, daysCount: 1 },
                mockTodoistApi,
            )

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: '(today | overdue) & !assigned to: others',
                cursor: undefined,
                limit: 50,
            })
            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()
        })

        it('should get tasks for today + multi-day range when daysCount > 1 (includes overdue)', async () => {
            const mockTasks = [createMappedTask({ content: 'Today task', dueDate: '2025-08-15' })]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                { startDate: 'today', limit: 50, daysCount: 7 },
                mockTodoistApi,
            )

            // With daysCount > 1, should build a date-range query instead of simple '(today | overdue)'
            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: expect.stringContaining('due before:'),
                cursor: undefined,
                limit: 50,
            })

            // Verify it includes overdue by default
            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('overdue')

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()
        })

        it('should exclude overdue for today + multi-day range when exclude-overdue', async () => {
            const mockTasks = [createMappedTask({ content: 'Today task', dueDate: '2025-08-15' })]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                {
                    startDate: 'today',
                    limit: 50,
                    daysCount: 7,
                    overdueOption: 'exclude-overdue',
                },
                mockTodoistApi,
            )

            // With exclude-overdue, should not include overdue in query
            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before:')
            expect(call?.query).not.toContain('overdue')

            expect(result.textContent).toMatchSnapshot()
        })

        it.each([
            {
                name: 'specific date',
                params: { startDate: '2025-08-20', limit: 50, daysCount: 7 },
                tasks: [createMappedTask({ content: 'Specific date task', dueDate: '2025-08-20' })],
                cursor: null,
            },
            {
                name: 'multiple days with pagination',
                params: {
                    startDate: '2025-08-20',
                    daysCount: 3,
                    limit: 20,
                    cursor: 'current-cursor',
                },
                tasks: [
                    createMappedTask({
                        id: TEST_IDS.TASK_2,
                        content: 'Multi-day task 1',
                        dueDate: '2025-08-20',
                    }),
                    createMappedTask({
                        id: TEST_IDS.TASK_3,
                        content: 'Multi-day task 2',
                        dueDate: '2025-08-21',
                    }),
                ],
                cursor: 'next-page-cursor',
            },
        ])('should handle $name', async ({ params, tasks, cursor }) => {
            const mockResponse = { tasks, nextCursor: cursor }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(params, mockTodoistApi)

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: expect.stringContaining('2025-08-20'),
                cursor: params.cursor || undefined,
                limit: params.limit,
            })
            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('pagination and limits', () => {
        it.each([
            {
                name: 'pagination parameters',
                params: {
                    startDate: 'today',
                    limit: 25,
                    daysCount: 1,
                    cursor: 'pagination-cursor',
                },
                expectedCursor: 'pagination-cursor',
                expectedLimit: 25,
            },
            {
                name: 'default values',
                params: { startDate: '2025-08-15', limit: 50, daysCount: 7 },
                expectedCursor: undefined,
                expectedLimit: 50,
            },
        ])('should handle $name', async ({ params, expectedCursor, expectedLimit }) => {
            const mockResponse = { tasks: [], nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            await findTasksByDate.execute(params, mockTodoistApi)

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: expect.any(String),
                cursor: expectedCursor,
                limit: expectedLimit,
            })
        })
    })

    describe('edge cases', () => {
        it.each([
            { name: 'empty results', daysCount: 1, shouldReturnResult: true },
            { name: 'maximum daysCount', daysCount: 30, shouldReturnResult: false },
            { name: 'minimum daysCount', daysCount: 1, shouldReturnResult: false },
        ])('should handle $name', async ({ daysCount, shouldReturnResult }) => {
            const mockResponse = { tasks: [], nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const startDate = daysCount === 7 ? 'today' : '2025-08-15'
            const result = await findTasksByDate.execute(
                { startDate, limit: 50, daysCount },
                mockTodoistApi,
            )

            expect(mockGetTasksByFilter).toHaveBeenCalledTimes(1)
            if (shouldReturnResult) {
                // Verify result is a concise summary
                expect(result.textContent).toMatchSnapshot()
            }
        })
    })

    describe('next steps logic', () => {
        it('should suggest appropriate actions when hasOverdue is true', async () => {
            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'Overdue task from list',
                    dueDate: '2025-08-10', // Past date - creates hasOverdue context
                }),
            ]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                {
                    startDate: '2025-08-15',
                    limit: 10,
                    daysCount: 1,
                },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
        })

        it('should suggest today-focused actions when startDate is today', async () => {
            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: "Today's task",
                    dueDate: '2025-08-15', // Today's date based on our mock
                }),
            ]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                { startDate: 'today', limit: 10, daysCount: 1 },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
        })

        it('should provide helpful suggestions for empty today results', async () => {
            const mockResponse = { tasks: [], nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                { startDate: 'today', limit: 10, daysCount: 1 },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Great job! No tasks for today or overdue')
        })

        it('should provide helpful suggestions for empty date range results', async () => {
            const mockResponse = { tasks: [], nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                {
                    startDate: '2025-08-20',
                    limit: 10,
                    daysCount: 1,
                },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain("Expand date range with larger 'daysCount'")
            expect(textContent).toContain("Check today's tasks with startDate='today'")
        })
    })

    describe('label filtering', () => {
        it.each([
            {
                name: 'single label with OR operator',
                params: {
                    startDate: 'today',
                    daysCount: 1,
                    limit: 50,
                    labels: ['work'],
                },
                expectedQueryPattern: '(today | overdue) & ((@work)) & !assigned to: others', // Will be combined with date query
            },
            {
                name: 'multiple labels with AND operator',
                params: {
                    startDate: 'today',
                    daysCount: 1,
                    limit: 50,
                    labels: ['work', 'urgent'],
                    labelsOperator: 'and' as const,
                },
                expectedQueryPattern:
                    '(today | overdue) & ((@work  &  @urgent)) & !assigned to: others',
            },
            {
                name: 'multiple labels with OR operator',
                params: {
                    startDate: '2025-08-20',
                    daysCount: 3,
                    limit: 50,
                    labels: ['personal', 'shopping'],
                    labelsOperator: 'or' as const,
                },
                expectedQueryPattern: '((@personal  |  @shopping))',
            },
        ])('should filter tasks by labels: $name', async ({ params, expectedQueryPattern }) => {
            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'Task with work label',
                    labels: ['work'],
                    dueDate: '2025-08-20',
                }),
            ]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(params, mockTodoistApi)

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: expect.stringContaining('(@'),
                cursor: undefined,
                limit: 50,
            })

            // For today specifically, check the exact pattern
            if (params.startDate === 'today') {
                expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                    client: mockTodoistApi,
                    query: expectedQueryPattern,
                    cursor: undefined,
                    limit: 50,
                })
            }

            const structuredContent = result.structuredContent
            expect(structuredContent.appliedFilters).toEqual(
                expect.objectContaining({
                    labels: params.labels,
                    ...(params.labelsOperator ? { labelsOperator: params.labelsOperator } : {}),
                }),
            )
        })

        it('should handle empty labels array', async () => {
            const params = {
                startDate: 'today' as const,
                daysCount: 1,
                limit: 50,
            }

            const mockResponse = { tasks: [], nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            await findTasksByDate.execute(params, mockTodoistApi)

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: expect.not.stringContaining('@'),
                cursor: undefined,
                limit: 50,
            })
        })

        it('should combine date filters with label filters', async () => {
            const params = {
                startDate: '2025-08-15' as const,
                daysCount: 1,
                limit: 25,
                labels: ['important'],
            }

            const mockTasks = [
                createMappedTask({
                    content: 'Important task for specific date',
                    labels: ['important'],
                    dueDate: '2025-08-15',
                }),
            ]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(params, mockTodoistApi)

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query:
                    expect.stringContaining('due after:') &&
                    expect.stringContaining('(@important)'),
                cursor: undefined,
                limit: 25,
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
        })
    })

    describe('responsible user filtering', () => {
        it('should filter results to show only unassigned tasks or tasks assigned to current user', async () => {
            // Backend filtering: API should only return unassigned + assigned to me
            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'My task',
                    dueDate: '2025-08-15',
                    responsibleUid: TEST_IDS.USER_ID, // Assigned to current user
                }),
                createMappedTask({
                    id: TEST_IDS.TASK_2,
                    content: 'Unassigned task',
                    dueDate: '2025-08-15',
                    responsibleUid: undefined, // Unassigned
                }),
            ]

            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                {
                    startDate: 'today',
                    daysCount: 1,
                    limit: 50,
                    responsibleUserFiltering: 'unassignedOrMe',
                },
                mockTodoistApi,
            )

            // Verify the query includes the assignment filter
            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: '(today | overdue) & !assigned to: others',
                cursor: undefined,
                limit: 50,
            })

            const structuredContent = result.structuredContent
            // Should only return tasks 1 and 2, not task 3
            expect(structuredContent.tasks as MappedTask[]).toHaveLength(2)
            expect((structuredContent.tasks as MappedTask[]).map((t: MappedTask) => t.id)).toEqual([
                TEST_IDS.TASK_1,
                TEST_IDS.TASK_2,
            ])
        })

        it('should filter overdue results to show only unassigned tasks or tasks assigned to current user', async () => {
            // Backend filtering: API should only return unassigned + assigned to me
            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'My overdue task',
                    dueDate: '2025-08-10',
                    responsibleUid: TEST_IDS.USER_ID, // Assigned to current user
                }),
                createMappedTask({
                    id: TEST_IDS.TASK_2,
                    content: 'Unassigned overdue task',
                    dueDate: '2025-08-10',
                    responsibleUid: undefined, // Unassigned
                }),
            ]

            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                {
                    overdueOption: 'overdue-only',
                    daysCount: 1,
                    limit: 50,
                    responsibleUserFiltering: 'unassignedOrMe',
                },
                mockTodoistApi,
            )

            // Verify the query includes the assignment filter
            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: 'overdue & !assigned to: others',
                cursor: undefined,
                limit: 50,
            })

            const structuredContent = result.structuredContent
            // Should only return tasks 1 and 2, not task 3
            expect(structuredContent.tasks).toHaveLength(2)
            expect((structuredContent.tasks as MappedTask[]).map((t: MappedTask) => t.id)).toEqual([
                TEST_IDS.TASK_1,
                TEST_IDS.TASK_2,
            ])
        })
    })

    describe('responsibleUser parameter', () => {
        it('should filter tasks by specific user email', async () => {
            mockResolveUserNameToId.mockResolvedValue({
                userId: 'user-123',
                displayName: 'John Doe',
                email: 'john@example.com',
            })

            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'Task assigned to John',
                    dueDate: '2025-08-15',
                    responsibleUid: 'user-123',
                }),
            ]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            const result = await findTasksByDate.execute(
                {
                    startDate: 'today',
                    daysCount: 1,
                    limit: 50,
                    responsibleUser: 'john@example.com',
                },
                mockTodoistApi,
            )

            expect(mockResolveUserNameToId).toHaveBeenCalledWith(mockTodoistApi, 'john@example.com')

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: '(today | overdue) & assigned to: john@example.com',
                cursor: undefined,
                limit: 50,
            })

            const textContent = result.textContent
            expect(textContent).toContain('assigned to john@example.com')
            expect(textContent).toMatchSnapshot()
        })

        it('should throw error when user cannot be resolved', async () => {
            mockResolveUserNameToId.mockResolvedValue(null)

            await expect(
                findTasksByDate.execute(
                    {
                        startDate: 'today',
                        daysCount: 1,
                        limit: 50,
                        responsibleUser: 'nonexistent@example.com',
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Could not find user: "nonexistent@example.com". Make sure the user is a collaborator on a shared project.',
            )
        })

        it('should combine responsibleUser with labels and date filters', async () => {
            mockResolveUserNameToId.mockResolvedValue({
                userId: 'user-789',
                displayName: 'Bob Wilson',
                email: 'bob@example.com',
            })

            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'Important task for Bob',
                    dueDate: '2025-08-20',
                    responsibleUid: 'user-789',
                    labels: ['urgent'],
                }),
            ]
            const mockResponse = { tasks: mockTasks, nextCursor: null }
            mockGetTasksByFilter.mockResolvedValue(mockResponse)

            await findTasksByDate.execute(
                {
                    startDate: '2025-08-20',
                    daysCount: 1,
                    limit: 50,
                    responsibleUser: 'bob@example.com',
                    labels: ['urgent'],
                },
                mockTodoistApi,
            )

            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: expect.stringContaining('2025-08-20'),
                cursor: undefined,
                limit: 50,
            })

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('(@urgent)')
            expect(call?.query).toContain('assigned to: bob@example.com')
        })
    })

    describe('error handling', () => {
        it.each([
            {
                error: TEST_ERRORS.INVALID_FILTER,
                params: { startDate: 'today', limit: 50, daysCount: 7 },
            },
            {
                error: TEST_ERRORS.API_RATE_LIMIT,
                params: { startDate: 'today', limit: 50, daysCount: 7 },
            },
            {
                error: TEST_ERRORS.INVALID_CURSOR,
                params: {
                    startDate: '2025-08-15',
                    limit: 50,
                    daysCount: 7,
                    cursor: 'invalid-cursor',
                },
            },
        ])('should propagate $error', async ({ error, params }) => {
            mockGetTasksByFilter.mockRejectedValue(new Error(error))
            await expect(findTasksByDate.execute(params, mockTodoistApi)).rejects.toThrow(error)
        })
    })
})
