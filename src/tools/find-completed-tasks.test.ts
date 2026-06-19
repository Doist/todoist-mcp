import type { CurrentUser, Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, type MockedFunction, vi } from 'vitest'
import { z } from 'zod'
import { createMockTask, createMockUser, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { userResolver } from '../utils/user-resolver.js'
import { findCompletedTasks } from './find-completed-tasks.js'

// Mock the Todoist API
const mockTodoistApi = {
    getCompletedTasksByCompletionDate: vi.fn(),
    getCompletedTasksByDueDate: vi.fn(),
    getUser: vi.fn(),
    getProjects: vi.fn(),
    getProjectCollaborators: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_COMPLETED_TASKS } = ToolNames

describe(`${FIND_COMPLETED_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Clear userResolver cache to ensure test isolation
        userResolver.clearCache()

        // Mock default user with UTC timezone
        mockTodoistApi.getUser.mockResolvedValue({
            id: 'test-user-id',
            fullName: 'Test User',
            email: 'test@example.com',
            tzInfo: {
                timezone: 'UTC',
                gmtString: '+00:00',
                hours: 0,
                minutes: 0,
                isDst: 0,
            },
        } as CurrentUser)

        // Mock default projects (no shared projects)
        mockTodoistApi.getProjects.mockResolvedValue({
            results: [],
            nextCursor: null,
        })
    })

    describe('getting completed tasks by completion date (default)', () => {
        it('should get completed tasks by completion date', async () => {
            const mockCompletedTasks: Task[] = [
                createMockTask({
                    id: '8485093748',
                    content: 'Completed task 1',
                    description: 'Task completed yesterday',
                    completedAt: new Date('2024-01-01T00:00:00Z'),
                    labels: ['work'],
                    priority: 'p3',
                    url: 'https://todoist.com/showTask?id=8485093748',
                    addedAt: new Date('2025-08-13T22:09:56.123456Z'),
                    due: {
                        date: '2025-08-14',
                        isRecurring: false,
                        lang: 'en',
                        string: 'Aug 14',
                        timezone: null,
                    },
                }),
            ]

            mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                items: mockCompletedTasks,
                nextCursor: null,
            })

            const result = await findCompletedTasks.execute(
                {
                    getBy: 'completion',
                    limit: 50,
                    since: '2025-08-10',
                    until: '2025-08-15',
                    labels: [],
                    labelsOperator: 'or' as const,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith({
                since: '2025-08-10T00:00:00.000Z',
                until: '2025-08-15T23:59:59.000Z',
                limit: 50,
            })

            expect(result.textContent).toMatchSnapshot()
        })

        it('should handle explicit completion date query', async () => {
            mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                items: [],
                nextCursor: 'next-cursor',
            })

            const result = await findCompletedTasks.execute(
                {
                    getBy: 'completion',
                    limit: 100,
                    since: '2025-08-01',
                    until: '2025-08-31',
                    projectId: 'specific-project-id',
                    cursor: 'current-cursor',
                    labels: [],
                    labelsOperator: 'or' as const,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith({
                since: '2025-08-01T00:00:00.000Z',
                until: '2025-08-31T23:59:59.000Z',
                projectId: 'specific-project-id',
                limit: 100,
                cursor: 'current-cursor',
            })

            expect(result.textContent).toMatchSnapshot()
        })

        it('should allow missing since/until and default to the last 7 days', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-03-03T12:00:00Z'))

            try {
                mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                    items: [],
                    nextCursor: null,
                })

                expect(() =>
                    z.object(findCompletedTasks.parameters).parse({
                        getBy: 'completion',
                        limit: 50,
                        labels: [],
                        labelsOperator: 'or',
                    }),
                ).not.toThrow()

                const result = await findCompletedTasks.execute(
                    {
                        getBy: 'completion',
                        limit: 50,
                        labels: [],
                        labelsOperator: 'or' as const,
                    },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith({
                    since: '2026-02-25T00:00:00.000Z',
                    until: '2026-03-03T23:59:59.000Z',
                    limit: 50,
                })

                expect(result.textContent).toContain('completed date: 2026-02-25 to 2026-03-03')
                expect(result.structuredContent.appliedFilters).toMatchObject({
                    since: '2026-02-25',
                    until: '2026-03-03',
                })
            } finally {
                vi.useRealTimers()
            }
        })

        it('should use user timezone when defaulting missing since/until', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-10-11T23:30:00Z'))

            try {
                mockTodoistApi.getUser.mockResolvedValue({
                    id: 'test-user-id',
                    fullName: 'Test User',
                    email: 'test@example.com',
                    tzInfo: {
                        timezone: 'Europe/Madrid',
                        gmtString: '+02:00',
                        hours: 2,
                        minutes: 0,
                        isDst: 0,
                    },
                } as CurrentUser)

                mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                    items: [],
                    nextCursor: null,
                })

                await findCompletedTasks.execute(
                    {
                        getBy: 'completion',
                        limit: 50,
                        labels: [],
                        labelsOperator: 'or' as const,
                    },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith({
                    since: '2025-10-05T22:00:00.000Z',
                    until: '2025-10-12T21:59:59.000Z',
                    limit: 50,
                })
            } finally {
                vi.useRealTimers()
            }
        })

        it('should require explicit since/until for cursor pagination to prevent date-window drift across midnight', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-03-03T12:00:00Z'))

            try {
                mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValueOnce({
                    items: [],
                    nextCursor: 'cursor-page-2',
                })

                const firstPage = await findCompletedTasks.execute(
                    {
                        getBy: 'completion',
                        limit: 50,
                        labels: [],
                        labelsOperator: 'or' as const,
                    },
                    mockTodoistApi,
                )

                expect(firstPage.structuredContent.nextCursor).toBe('cursor-page-2')

                // Simulate next-page fetch that happens after midnight.
                // Without explicit since/until, defaults could shift to a different window.
                vi.setSystemTime(new Date('2026-03-04T12:00:00Z'))

                await expect(
                    findCompletedTasks.execute(
                        {
                            getBy: 'completion',
                            limit: 50,
                            cursor: 'cursor-page-2',
                            labels: [],
                            labelsOperator: 'or' as const,
                        },
                        mockTodoistApi,
                    ),
                ).rejects.toThrow(
                    'Cursor pagination requires explicit since and until. Reuse structuredContent.appliedFilters.since and structuredContent.appliedFilters.until from the previous page.',
                )
            } finally {
                vi.useRealTimers()
            }
        })
    })

    describe('getting completed tasks by due date', () => {
        it('should get completed tasks by due date', async () => {
            const mockCompletedTasks: Task[] = [
                createMockTask({
                    id: '8485093750',
                    content: 'Task completed by due date',
                    description: 'This task was due and completed',
                    completedAt: new Date('2024-01-01T00:00:00Z'),
                    labels: ['urgent'],
                    priority: 'p2',
                    url: 'https://todoist.com/showTask?id=8485093750',
                    addedAt: new Date('2025-08-13T22:09:58.123456Z'),
                    due: {
                        date: '2025-08-15',
                        isRecurring: true,
                        lang: 'en',
                        string: 'every Monday',
                        timezone: null,
                    },
                }),
            ]

            mockTodoistApi.getCompletedTasksByDueDate.mockResolvedValue({
                items: mockCompletedTasks,
                nextCursor: null,
            })

            const result = await findCompletedTasks.execute(
                {
                    getBy: 'due',
                    limit: 50,
                    since: '2025-08-10',
                    until: '2025-08-20',
                    labels: [],
                    labelsOperator: 'or' as const,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getCompletedTasksByDueDate).toHaveBeenCalledWith({
                since: '2025-08-10T00:00:00.000Z',
                until: '2025-08-20T23:59:59.000Z',
                limit: 50,
            })
            expect(mockTodoistApi.getCompletedTasksByCompletionDate).not.toHaveBeenCalled()

            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('label filtering', () => {
        it.each([
            {
                name: 'single label with OR operator',
                params: {
                    getBy: 'completion' as const,
                    since: '2025-08-01',
                    until: '2025-08-31',
                    limit: 50,
                    labels: ['work'],
                },
                expectedMethod: 'getCompletedTasksByCompletionDate',
                expectedFilter: '(@work)',
            },
            {
                name: 'multiple labels with AND operator',
                params: {
                    getBy: 'due' as const,
                    since: '2025-08-01',
                    until: '2025-08-31',
                    limit: 50,
                    labels: ['work', 'urgent'],
                    labelsOperator: 'and' as const,
                },
                expectedMethod: 'getCompletedTasksByDueDate',
                expectedFilter: '(@work  &  @urgent)',
            },
            {
                name: 'multiple labels with OR operator',
                params: {
                    getBy: 'completion' as const,
                    since: '2025-08-10',
                    until: '2025-08-20',
                    limit: 25,
                    labels: ['personal', 'shopping'],
                },
                expectedMethod: 'getCompletedTasksByCompletionDate',
                expectedFilter: '(@personal  |  @shopping)',
            },
        ])(
            'should filter completed tasks by labels: $name',
            async ({ params, expectedMethod, expectedFilter }) => {
                const mockCompletedTasks = [
                    createMockTask({
                        id: '8485093748',
                        content: 'Completed task with label',
                        labels: params.labels,
                        completedAt: new Date('2024-01-01T00:00:00Z'),
                    }),
                ]

                const mockResponse = { items: mockCompletedTasks, nextCursor: null }
                const mockMethod = mockTodoistApi[
                    expectedMethod as keyof typeof mockTodoistApi
                ] as MockedFunction<
                    (...args: never[]) => Promise<{ items: unknown[]; nextCursor: string | null }>
                >
                mockMethod.mockResolvedValue(mockResponse)

                const result = await findCompletedTasks.execute(params, mockTodoistApi)

                expect(mockMethod).toHaveBeenCalledWith({
                    since: `${params.since}T00:00:00.000Z`,
                    until: `${params.until}T23:59:59.000Z`,
                    limit: params.limit,
                    filterQuery: expectedFilter,
                    filterLang: 'en',
                })

                const textContent = result.textContent
                expect(textContent).toMatchSnapshot()
            },
        )

        it('should handle empty labels array', async () => {
            const params = {
                getBy: 'completion' as const,
                since: '2025-08-01',
                until: '2025-08-31',
                limit: 50,
                labels: [],
                labelsOperator: 'or' as const,
            }

            const mockResponse = { items: [], nextCursor: null }
            mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue(mockResponse)

            await findCompletedTasks.execute(params, mockTodoistApi)

            expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith({
                since: `${params.since}T00:00:00.000Z`,
                until: `${params.until}T23:59:59.000Z`,
                limit: params.limit,
            })
        })

        it('should combine other filters with label filters', async () => {
            const params = {
                getBy: 'due' as const,
                since: '2025-08-01',
                until: '2025-08-31',
                limit: 25,
                projectId: 'test-project-id',
                sectionId: 'test-section-id',
                labels: ['important'],
                labelsOperator: 'or' as const,
            }

            const mockTasks = [
                createMockTask({
                    content: 'Important completed task',
                    labels: ['important'],
                    completedAt: new Date('2024-01-01T00:00:00Z'),
                }),
            ]
            const mockResponse = { items: mockTasks, nextCursor: null }
            mockTodoistApi.getCompletedTasksByDueDate.mockResolvedValue(mockResponse)

            const result = await findCompletedTasks.execute(params, mockTodoistApi)

            expect(mockTodoistApi.getCompletedTasksByDueDate).toHaveBeenCalledWith({
                since: `${params.since}T00:00:00.000Z`,
                until: `${params.until}T23:59:59.000Z`,
                limit: params.limit,
                projectId: params.projectId,
                sectionId: params.sectionId,
                filterQuery: '(@important)',
                filterLang: 'en',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
        })
    })

    describe('timezone handling', () => {
        it('should convert user timezone to UTC correctly (Europe/Madrid)', async () => {
            // Mock user with Madrid timezone
            mockTodoistApi.getUser.mockResolvedValue({
                id: 'test-user-id',
                fullName: 'Test User',
                email: 'test@example.com',
                tzInfo: {
                    timezone: 'Europe/Madrid',
                    gmtString: '+02:00',
                    hours: 2,
                    minutes: 0,
                    isDst: 0,
                },
            } as CurrentUser)

            const mockCompletedTasks: Task[] = [
                createMockTask({
                    id: '8485093750',
                    content: 'Task completed in Madrid timezone',
                    completedAt: new Date('2025-10-11T15:30:00Z'),
                }),
            ]

            mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                items: mockCompletedTasks,
                nextCursor: null,
            })

            const result = await findCompletedTasks.execute(
                {
                    getBy: 'completion',
                    limit: 50,
                    since: '2025-10-11',
                    until: '2025-10-11',
                    labels: [],
                    labelsOperator: 'or' as const,
                },
                mockTodoistApi,
            )

            // Should convert Madrid local time to UTC
            // 2025-10-11 00:00:00 +02:00 = 2025-10-10 22:00:00 UTC
            // 2025-10-11 23:59:59 +02:00 = 2025-10-11 21:59:59 UTC
            expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith({
                since: '2025-10-10T22:00:00.000Z',
                until: '2025-10-11T21:59:59.000Z',
                limit: 50,
            })

            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('error handling', () => {
        it('should propagate completion date API errors', async () => {
            const apiError = new Error('API Error: Invalid date range')
            mockTodoistApi.getCompletedTasksByCompletionDate.mockRejectedValue(apiError)

            await expect(
                findCompletedTasks.execute(
                    // invalid date range
                    {
                        getBy: 'completion',
                        limit: 50,
                        since: '2025-08-31',
                        until: '2025-08-01',
                        labels: [],
                        labelsOperator: 'or' as const,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Invalid date range')
        })

        it('should propagate due date API errors', async () => {
            const apiError = new Error('API Error: Project not found')
            mockTodoistApi.getCompletedTasksByDueDate.mockRejectedValue(apiError)

            await expect(
                findCompletedTasks.execute(
                    {
                        getBy: 'due',
                        limit: 50,
                        since: '2025-08-01',
                        until: '2025-08-31',
                        projectId: 'non-existent-project',
                        labels: [],
                        labelsOperator: 'or' as const,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Project not found')
        })
    })

    describe('inbox project ID resolution', () => {
        it('should resolve "inbox" to actual inbox project ID', async () => {
            const mockUser = createMockUser({
                inboxProjectId: TEST_IDS.PROJECT_INBOX,
                tzInfo: {
                    timezone: 'UTC',
                    gmtString: '+00:00',
                    hours: 0,
                    minutes: 0,
                    isDst: 0,
                },
            })
            const mockCompletedTasks: Task[] = [
                createMockTask({
                    id: '8485093760',
                    content: 'Completed inbox task',
                    projectId: TEST_IDS.PROJECT_INBOX,
                    completedAt: new Date('2025-08-15T12:00:00Z'),
                    url: 'https://todoist.com/showTask?id=8485093760',
                    addedAt: new Date('2025-08-13T22:09:56.123456Z'),
                }),
            ]

            // Mock getUser to return our mock user with inbox ID
            mockTodoistApi.getUser.mockResolvedValue(mockUser)

            // Mock the API response
            mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                items: mockCompletedTasks,
                nextCursor: null,
            })

            const result = await findCompletedTasks.execute(
                {
                    getBy: 'completion',
                    since: '2025-08-15',
                    until: '2025-08-15',
                    projectId: 'inbox',
                    labels: [],
                    labelsOperator: 'or' as const,
                    limit: 50,
                },
                mockTodoistApi,
            )

            // Verify getUser was called
            expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(1)

            // Verify getCompletedTasksByCompletionDate was called with resolved inbox project ID
            expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectId: TEST_IDS.PROJECT_INBOX,
                    since: '2025-08-15T00:00:00.000Z',
                    until: '2025-08-15T23:59:59.000Z',
                    limit: 50,
                }),
            )

            // Verify result contains the completed tasks
            const textContent = result.textContent
            expect(textContent).toContain('Completed tasks')
            expect(textContent).toContain('Completed inbox task')
        })

        it('should use regular project ID when not "inbox"', async () => {
            const mockUser = createMockUser({
                tzInfo: {
                    timezone: 'UTC',
                    gmtString: '+00:00',
                    hours: 0,
                    minutes: 0,
                    isDst: 0,
                },
            })
            const mockCompletedTasks: Task[] = [
                createMockTask({
                    id: '8485093761',
                    content: 'Completed regular task',
                    projectId: '6cfCcrrCFg2xP94Q',
                    completedAt: new Date('2025-08-15T12:00:00Z'),
                    url: 'https://todoist.com/showTask?id=8485093761',
                    addedAt: new Date('2025-08-13T22:09:56.123456Z'),
                }),
            ]

            // Mock getUser (will be called for timezone, but inbox resolution won't happen)
            mockTodoistApi.getUser.mockResolvedValue(mockUser)

            // Mock the API response
            mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                items: mockCompletedTasks,
                nextCursor: null,
            })

            await findCompletedTasks.execute(
                {
                    getBy: 'completion',
                    since: '2025-08-15',
                    until: '2025-08-15',
                    projectId: '6cfCcrrCFg2xP94Q',
                    labels: [],
                    labelsOperator: 'or' as const,
                    limit: 50,
                },
                mockTodoistApi,
            )

            // Verify getUser was called (for timezone info)
            expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(1)

            // Verify getCompletedTasksByCompletionDate was called with original project ID
            expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectId: '6cfCcrrCFg2xP94Q',
                    since: '2025-08-15T00:00:00.000Z',
                    until: '2025-08-15T23:59:59.000Z',
                    limit: 50,
                }),
            )
        })
    })

    describe('responsibleUser resolution with current user', () => {
        const brennaUser = {
            id: 'brenna-user-id',
            fullName: 'Brenna Smith',
            email: 'brenna@example.com',
            tzInfo: {
                timezone: 'UTC',
                gmtString: '+00:00',
                hours: 0,
                minutes: 0,
                isDst: 0,
            },
        } as CurrentUser

        it.each([
            { name: 'exact full name', responsibleUser: 'Brenna Smith' },
            { name: 'email', responsibleUser: 'brenna@example.com' },
            { name: 'partial name', responsibleUser: 'brenna' },
            { name: 'user ID', responsibleUser: 'brenna-user-id' },
        ])(
            'should resolve responsibleUser to current user by $name',
            async ({ responsibleUser }) => {
                mockTodoistApi.getUser.mockResolvedValue(brennaUser)
                mockTodoistApi.getCompletedTasksByCompletionDate.mockResolvedValue({
                    items: [],
                    nextCursor: null,
                })

                await findCompletedTasks.execute(
                    {
                        getBy: 'completion',
                        since: '2025-08-15',
                        until: '2025-08-15',
                        responsibleUser,
                        labels: [],
                        labelsOperator: 'or' as const,
                        limit: 50,
                    },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.getCompletedTasksByCompletionDate).toHaveBeenCalledWith(
                    expect.objectContaining({
                        filterQuery: 'assigned to: brenna@example.com',
                        filterLang: 'en',
                    }),
                )
            },
        )

        it('should throw error when responsibleUser does not match current user and no collaborators exist', async () => {
            await expect(
                findCompletedTasks.execute(
                    {
                        getBy: 'completion',
                        since: '2025-08-15',
                        until: '2025-08-15',
                        responsibleUser: 'nonexistent-user',
                        labels: [],
                        labelsOperator: 'or' as const,
                        limit: 50,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Could not find user: "nonexistent-user"')
        })
    })
})
