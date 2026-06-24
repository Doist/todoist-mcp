import type { Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { assignmentValidator } from '../utils/assignment-validator.js'
import { convertPriorityToNumber } from '../utils/priorities.js'
import {
    createMockProject,
    createMockSection,
    createMockTask,
    TEST_IDS,
    TODAY,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { addTasks, MAX_TASKS_PER_OPERATION } from './add-tasks.js'

// Mock the Todoist API
const mockTodoistApi = {
    addTask: vi.fn(),
    getProject: vi.fn(),
    getSection: vi.fn(),
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_TASKS } = ToolNames

describe(`${ADD_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getProject.mockResolvedValue(createMockProject())
    })

    describe('adding multiple tasks', () => {
        it('should add multiple tasks and return mapped results', async () => {
            // Mock API responses extracted from recordings (Task type)
            const mockApiResponse1: Task = createMockTask({
                id: '8485093748',
                content: 'First task content',
                url: 'https://todoist.com/showTask?id=8485093748',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            const mockApiResponse2: Task = createMockTask({
                id: '8485093749',
                content: 'Second task content',
                description: 'Task description',
                labels: ['work', 'urgent'],
                childOrder: 2,
                priority: 'p3',
                url: 'https://todoist.com/showTask?id=8485093749',
                addedAt: new Date('2025-08-13T22:09:57.123456Z'),
                due: {
                    date: '2025-08-15',
                    isRecurring: false,
                    lang: 'en',
                    string: 'Aug 15',
                    timezone: null,
                },
            })

            mockTodoistApi.addTask
                .mockResolvedValueOnce(mockApiResponse1)
                .mockResolvedValueOnce(mockApiResponse2)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'First task content',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                        {
                            content: 'Second task content',
                            description: 'Task description',
                            priority: 'p2',
                            dueString: 'Aug 15',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly for each task
            expect(mockTodoistApi.addTask).toHaveBeenCalledTimes(2)

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent.tasks).toHaveLength(2)
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    totalCount: 2,
                    totalRequested: 2,
                    successCount: 2,
                    failureCount: 0,
                    failures: [],
                    tasks: expect.arrayContaining([
                        expect.objectContaining({ id: '8485093748' }),
                        expect.objectContaining({ id: '8485093749' }),
                    ]),
                }),
            )
        })

        it('should handle tasks with section and parent IDs', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093750',
                content: 'Subtask content',
                description: 'Subtask description',
                priority: 'p2',
                sectionId: 'section-123',
                parentId: 'parent-task-456',
                url: 'https://todoist.com/showTask?id=8485093750',
                addedAt: new Date('2025-08-13T22:09:58.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Subtask content',
                            description: 'Subtask description',
                            priority: 'p3',
                            projectId: '6cfCcrrCFg2xP94Q',
                            sectionId: 'section-123',
                            parentId: 'parent-task-456',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Subtask content',
                description: 'Subtask description',
                priority: convertPriorityToNumber('p3'),
                projectId: '6cfCcrrCFg2xP94Q',
                sectionId: 'section-123',
                parentId: 'parent-task-456',
            })

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    totalCount: 1,
                    successCount: 1,
                    failureCount: 0,
                    failures: [],
                    tasks: expect.arrayContaining([expect.objectContaining({ id: '8485093750' })]),
                }),
            )
        })

        it('should add tasks with duration', async () => {
            const mockApiResponse1: Task = createMockTask({
                id: '8485093752',
                content: 'Task with 2 hour duration',
                duration: { amount: 120, unit: 'minute' },
                url: 'https://todoist.com/showTask?id=8485093752',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            const mockApiResponse2: Task = createMockTask({
                id: '8485093753',
                content: 'Task with 45 minute duration',
                duration: { amount: 45, unit: 'minute' },
                url: 'https://todoist.com/showTask?id=8485093753',
                addedAt: new Date('2025-08-13T22:09:57.123456Z'),
            })

            mockTodoistApi.addTask
                .mockResolvedValueOnce(mockApiResponse1)
                .mockResolvedValueOnce(mockApiResponse2)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task with 2 hour duration',
                            duration: '2h',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                        {
                            content: 'Task with 45 minute duration',
                            duration: '45m',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent.tasks).toHaveLength(2)
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    totalCount: 2,
                    successCount: 2,
                    failureCount: 0,
                    tasks: expect.arrayContaining([
                        expect.objectContaining({ id: '8485093752' }),
                        expect.objectContaining({ id: '8485093753' }),
                    ]),
                }),
            )
        })

        it('should handle various duration formats', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093754',
                content: 'Task with combined duration',
                duration: { amount: 150, unit: 'minute' },
                url: 'https://todoist.com/showTask?id=8485093754',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            // Test different duration formats
            const testCases = [
                { input: '2h30m', expectedMinutes: 150 },
                { input: '1.5h', expectedMinutes: 90 },
                { input: ' 90m ', expectedMinutes: 90 },
                { input: '2H30M', expectedMinutes: 150 },
            ]

            for (const testCase of testCases) {
                mockTodoistApi.addTask.mockClear()

                await addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Test task',
                                duration: testCase.input,
                                projectId: '6cfCcrrCFg2xP94Q',
                            },
                        ],
                    },
                    mockTodoistApi,
                )

                expect(mockTodoistApi.addTask).toHaveBeenCalledWith(
                    expect.objectContaining({
                        duration: testCase.expectedMinutes,
                        durationUnit: 'minute',
                    }),
                )
            }
        })

        it('should add task with deadline', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093756',
                content: 'Task with deadline',
                deadline: {
                    date: '2025-12-31',
                    lang: 'en',
                },
                url: 'https://todoist.com/showTask?id=8485093756',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task with deadline',
                            projectId: '6cfCcrrCFg2xP94Q',
                            deadlineDate: '2025-12-31',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called with deadline
            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Task with deadline',
                projectId: '6cfCcrrCFg2xP94Q',
                sectionId: undefined,
                parentId: undefined,
                deadlineDate: '2025-12-31',
            })

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content includes deadline
            const structuredContent = result.structuredContent
            expect(structuredContent.tasks).toHaveLength(1)
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    totalCount: 1,
                    successCount: 1,
                    failureCount: 0,
                    tasks: expect.arrayContaining([
                        expect.objectContaining({
                            id: '8485093756',
                            deadlineDate: '2025-12-31',
                        }),
                    ]),
                }),
            )
        })

        it('should add task with labels', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093755',
                content: 'Task with labels',
                labels: ['urgent', 'work'],
                url: 'https://todoist.com/showTask?id=8485093755',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task with labels',
                            labels: ['urgent', 'work'],
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Task with labels',
                labels: ['urgent', 'work'],
                projectId: '6cfCcrrCFg2xP94Q',
                sectionId: undefined,
                parentId: undefined,
            })

            // Verify structured content includes labels
            const structuredContent = result.structuredContent
            expect(structuredContent.tasks).toHaveLength(1)
            expect(structuredContent.tasks).toEqual(
                expect.arrayContaining([expect.objectContaining({ labels: ['urgent', 'work'] })]),
            )
        })

        it('should add task with empty labels array', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093756',
                content: 'Task with empty labels',
                labels: [],
                url: 'https://todoist.com/showTask?id=8485093756',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task with empty labels',
                            labels: [],
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Task with empty labels',
                labels: [],
                projectId: '6cfCcrrCFg2xP94Q',
                sectionId: undefined,
                parentId: undefined,
            })
        })

        it('should add task without labels field', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093757',
                content: 'Task without labels',
                url: 'https://todoist.com/showTask?id=8485093757',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task without labels',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Task without labels',
                labels: undefined,
                projectId: '6cfCcrrCFg2xP94Q',
                sectionId: undefined,
                parentId: undefined,
            })
        })

        it('should add multiple tasks with different label configurations', async () => {
            const mockApiResponse1: Task = createMockTask({
                id: '8485093758',
                content: 'Task with labels',
                labels: ['personal'],
            })
            const mockApiResponse2: Task = createMockTask({
                id: '8485093759',
                content: 'Task without labels',
            })
            const mockApiResponse3: Task = createMockTask({
                id: '8485093760',
                content: 'Task with multiple labels',
                labels: ['work', 'urgent', 'review'],
            })

            mockTodoistApi.addTask
                .mockResolvedValueOnce(mockApiResponse1)
                .mockResolvedValueOnce(mockApiResponse2)
                .mockResolvedValueOnce(mockApiResponse3)

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task with labels',
                            labels: ['personal'],
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                        {
                            content: 'Task without labels',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                        {
                            content: 'Task with multiple labels',
                            labels: ['work', 'urgent', 'review'],
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledTimes(3)
        })
    })

    describe('error handling', () => {
        it('should throw error for invalid duration format', async () => {
            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Task with invalid duration',
                                duration: 'invalid',
                                projectId: '6cfCcrrCFg2xP94Q',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Task with invalid duration": Invalid duration format "invalid"',
            )
        })

        it('should throw error for duration exceeding 24 hours', async () => {
            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Task with too long duration',
                                duration: '25h',
                                projectId: '6cfCcrrCFg2xP94Q',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Task with too long duration": Invalid duration format "25h": Duration cannot exceed 24 hours (1440 minutes)',
            )
        })

        it('should throw error when single task fails (all-fail case)', async () => {
            const apiError = new Error('API Error: Bad Request')
            mockTodoistApi.addTask.mockRejectedValue(apiError)

            await expect(
                addTasks.execute(
                    { tasks: [{ content: 'Test task', projectId: '6cfCcrrCFg2xP94Q' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(apiError.message)
        })

        it('should handle partial failures and return both successes and failures', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093751',
                content: 'First task content',
                url: 'https://todoist.com/showTask?id=8485093751',
                addedAt: new Date('2025-08-13T22:09:59.123456Z'),
            })

            const apiError = new Error('API Error: Second task failed')
            mockTodoistApi.addTask
                .mockResolvedValueOnce(mockApiResponse)
                .mockRejectedValueOnce(apiError)

            const result = await addTasks.execute(
                {
                    tasks: [
                        { content: 'First task content', projectId: '6cfCcrrCFg2xP94Q' },
                        { content: 'Second task content', projectId: '6cfCcrrCFg2xP94Q' },
                    ],
                },
                mockTodoistApi,
            )

            // Should succeed with partial results
            expect(result.structuredContent.successCount).toBe(1)
            expect(result.structuredContent.failureCount).toBe(1)
            expect(result.structuredContent.totalRequested).toBe(2)
            expect(result.structuredContent.tasks).toHaveLength(1)
            expect(result.structuredContent.tasks[0]).toEqual(
                expect.objectContaining({ id: '8485093751' }),
            )
            expect(result.structuredContent.failures).toHaveLength(1)
            expect(result.structuredContent.failures[0]).toEqual(
                expect.objectContaining({
                    item: 'Second task content',
                    error: 'API Error: Second task failed',
                }),
            )

            // Text content should reflect partial success
            expect(result.textContent).toContain('1/2 successful')
        })

        it('should throw error when all tasks in a batch fail', async () => {
            const apiError1 = new Error('API Error: First task failed')
            const apiError2 = new Error('API Error: Second task failed')
            mockTodoistApi.addTask.mockRejectedValueOnce(apiError1).mockRejectedValueOnce(apiError2)

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            { content: 'First task', projectId: '6cfCcrrCFg2xP94Q' },
                            { content: 'Second task', projectId: '6cfCcrrCFg2xP94Q' },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('All 2 task(s) failed to create')
        })
    })

    describe('next steps logic', () => {
        it('should suggest find-tasks-by-date for today when hasToday is true', async () => {
            // Clear any leftover mocks from previous tests
            mockTodoistApi.addTask.mockClear()

            const mockApiResponse: Task = createMockTask({
                id: '8485093755',
                content: 'Task due today',
                url: 'https://todoist.com/showTask?id=8485093755',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
                due: {
                    date: TODAY,
                    isRecurring: false,
                    lang: 'en',
                    string: 'today',
                    timezone: null,
                },
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task due today',
                            dueString: 'today',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
        })

        it('should suggest overview tool when no hasToday context', async () => {
            // Clear any leftover mocks from previous tests
            mockTodoistApi.addTask.mockClear()

            const mockApiResponse: Task = createMockTask({
                id: '8485093756',
                content: 'Regular task',
                url: 'https://todoist.com/showTask?id=8485093756',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [{ content: 'Regular task', projectId: '6cfCcrrCFg2xP94Q' }],
                },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
        })
    })

    describe('tasks without project context', () => {
        it('should allow creating tasks with only content (goes to Inbox)', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093758',
                content: 'Simple inbox task',
                url: 'https://todoist.com/showTask?id=8485093758',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Simple inbox task',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Simple inbox task',
                labels: undefined,
                projectId: undefined,
                sectionId: undefined,
                parentId: undefined,
            })

            const textContent = result.textContent
            expect(textContent).toContain('Added 1 task')
            expect(textContent).toContain('Simple inbox task')
        })

        it('should prevent assignment without project context', async () => {
            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Task with assignment but no project',
                                responsibleUser: 'user@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Task with assignment but no project": Cannot assign tasks without specifying project context. Please specify a projectId, sectionId, or parentId.',
            )
        })

        it('should resolve project from section when assigning with sectionId but no projectId', async () => {
            mockTodoistApi.getSection.mockResolvedValue(
                createMockSection({ id: TEST_IDS.SECTION_1, projectId: TEST_IDS.PROJECT_WORK }),
            )
            const validateSpy = vi
                .spyOn(assignmentValidator, 'validateTaskCreationAssignment')
                .mockResolvedValue({
                    isValid: true,
                    resolvedUser: {
                        userId: 'assignee-1',
                        displayName: 'Assignee One',
                        email: 'user@example.com',
                    },
                })
            mockTodoistApi.addTask.mockResolvedValue(
                createMockTask({ id: '8485099001', content: 'Section task' }),
            )

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Section task',
                            sectionId: TEST_IDS.SECTION_1,
                            responsibleUser: 'user@example.com',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getSection).toHaveBeenCalledWith(TEST_IDS.SECTION_1)
            // Project for assignment validation is taken from the section, not required as input
            expect(validateSpy).toHaveBeenCalledWith(
                mockTodoistApi,
                TEST_IDS.PROJECT_WORK,
                'user@example.com',
            )
            expect(mockTodoistApi.addTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    assigneeId: 'assignee-1',
                    sectionId: TEST_IDS.SECTION_1,
                }),
            )
            validateSpy.mockRestore()
        })

        it('should resolve the section only once when batching tasks in the same section', async () => {
            mockTodoistApi.getSection.mockResolvedValue(
                createMockSection({ id: TEST_IDS.SECTION_1, projectId: TEST_IDS.PROJECT_WORK }),
            )
            const validateSpy = vi
                .spyOn(assignmentValidator, 'validateTaskCreationAssignment')
                .mockResolvedValue({
                    isValid: true,
                    resolvedUser: {
                        userId: 'assignee-1',
                        displayName: 'Assignee One',
                        email: 'user@example.com',
                    },
                })
            mockTodoistApi.addTask.mockResolvedValue(
                createMockTask({ id: '8485099002', content: 'Section task' }),
            )

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Section task 1',
                            sectionId: TEST_IDS.SECTION_1,
                            responsibleUser: 'user@example.com',
                        },
                        {
                            content: 'Section task 2',
                            sectionId: TEST_IDS.SECTION_1,
                            responsibleUser: 'user@example.com',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getSection).toHaveBeenCalledTimes(1)
            validateSpy.mockRestore()
        })

        it('should throw a clear error when the section does not exist', async () => {
            mockTodoistApi.getSection.mockResolvedValue(null as unknown as never)

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Section task',
                                sectionId: 'missing-section',
                                responsibleUser: 'user@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Task "Section task": Section "missing-section" not found')
        })

        it('should propagate non-not-found errors when resolving the section', async () => {
            mockTodoistApi.getSection.mockRejectedValue(new Error('Service Unavailable'))

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Section task',
                                sectionId: TEST_IDS.SECTION_1,
                                responsibleUser: 'user@example.com',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Service Unavailable')
        })
    })

    describe('inbox project ID handling', () => {
        it('should strip "inbox" projectId and let the API default to inbox', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485093760',
                content: 'Task for inbox',
                projectId: TEST_IDS.PROJECT_INBOX,
                url: 'https://todoist.com/showTask?id=8485093760',
                addedAt: new Date('2025-08-13T22:09:56.123456Z'),
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task for inbox',
                            projectId: 'inbox',
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Should NOT call getUser — inbox is handled by stripping projectId
            expect(mockTodoistApi.getUser).not.toHaveBeenCalled()

            // Verify addTask was called without projectId (API defaults to inbox)
            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Task for inbox',
                projectId: undefined,
                sectionId: undefined,
                parentId: undefined,
                labels: undefined,
            })

            // Verify result contains the task
            const structuredContent = result.structuredContent
            expect(structuredContent.totalCount).toBe(1)
            expect(structuredContent.tasks).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: '8485093760' })]),
            )
        })

        it('should not call getUser for multiple inbox tasks', async () => {
            const mockApiResponse1: Task = createMockTask({
                id: '8485093761',
                content: 'Inbox task 1',
                projectId: TEST_IDS.PROJECT_INBOX,
            })
            const mockApiResponse2: Task = createMockTask({
                id: '8485093762',
                content: 'Inbox task 2',
                projectId: TEST_IDS.PROJECT_INBOX,
            })

            mockTodoistApi.addTask
                .mockResolvedValueOnce(mockApiResponse1)
                .mockResolvedValueOnce(mockApiResponse2)

            await addTasks.execute(
                {
                    tasks: [
                        { content: 'Inbox task 1', projectId: 'inbox' },
                        { content: 'Inbox task 2', projectId: 'inbox' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getUser).not.toHaveBeenCalled()
            expect(mockTodoistApi.addTask).toHaveBeenCalledTimes(2)
        })
    })

    describe('isUncompletable parameter', () => {
        it('should pass isUncompletable parameter to SDK', async () => {
            // Mock API response - minimal mock just to prevent errors
            const mockApiResponse: Task = createMockTask({
                id: '8485093999',
                content: 'Project Header',
            })

            mockTodoistApi.addTask.mockResolvedValueOnce(mockApiResponse)

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Project Header',
                            isUncompletable: true,
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Verify the parameter was passed to the SDK - this is the key test
            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Project Header',
                projectId: undefined,
                sectionId: undefined,
                parentId: undefined,
                labels: undefined,
                isUncompletable: true,
            })
        })
    })

    describe('order parameter', () => {
        it('should pass order parameter to SDK', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485094000',
                content: 'Task with order',
                childOrder: 5,
            })

            mockTodoistApi.addTask.mockResolvedValueOnce(mockApiResponse)

            await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task with order',
                            order: 5,
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Task with order',
                projectId: '6cfCcrrCFg2xP94Q',
                sectionId: undefined,
                parentId: undefined,
                order: 5,
                labels: undefined,
            })
        })
    })

    describe('archived project validation', () => {
        it('should throw error when project is archived', async () => {
            mockTodoistApi.getProject.mockResolvedValue(
                createMockProject({ isArchived: true, name: 'Archived Project' }),
            )

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Task in archived project',
                                projectId: '6cfCcrrCFg2xP94Q',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Task "Task in archived project": Cannot create task in archived project "Archived Project"',
            )

            expect(mockTodoistApi.addTask).not.toHaveBeenCalled()
        })

        it('should not check project when projectId is omitted', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485094001',
                content: 'Inbox task',
            })
            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            await addTasks.execute({ tasks: [{ content: 'Inbox task' }] }, mockTodoistApi)

            expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.addTask).toHaveBeenCalled()
        })

        it('should propagate error when project is deleted (not found)', async () => {
            mockTodoistApi.getProject.mockRejectedValue(new Error('Project not found'))

            await expect(
                addTasks.execute(
                    {
                        tasks: [
                            {
                                content: 'Task in deleted project',
                                projectId: 'deleted-project-id',
                            },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Project not found')

            expect(mockTodoistApi.addTask).not.toHaveBeenCalled()
        })

        it('should allow task creation in active project', async () => {
            mockTodoistApi.getProject.mockResolvedValue(createMockProject({ isArchived: false }))
            const mockApiResponse: Task = createMockTask({
                id: '8485094002',
                content: 'Task in active project',
            })
            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Task in active project',
                            projectId: '6cfCcrrCFg2xP94Q',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProject).toHaveBeenCalledWith('6cfCcrrCFg2xP94Q')
            expect(mockTodoistApi.addTask).toHaveBeenCalled()
            expect(result.structuredContent.totalCount).toBe(1)
        })
    })

    describe('empty string sanitization', () => {
        it('should strip empty strings from optional fields before calling the API', async () => {
            const mockApiResponse: Task = createMockTask({
                id: '8485094010',
                content: 'Test',
            })

            mockTodoistApi.addTask.mockResolvedValue(mockApiResponse)

            // This is the exact input shape LLMs often send — empty strings for all optional fields
            const result = await addTasks.execute(
                {
                    tasks: [
                        {
                            content: 'Test',
                            description: '',
                            priority: 'p4',
                            dueString: '',
                            deadlineDate: '',
                            duration: '',
                            labels: [],
                            projectId: '',
                            sectionId: '',
                            parentId: '',
                            order: 0,
                            responsibleUser: '',
                            isUncompletable: false,
                        },
                    ],
                },
                mockTodoistApi,
            )

            // Empty strings should be stripped to undefined, not passed to the API
            // priority 'p4' is valid (not empty) so it gets converted to numeric 1
            expect(mockTodoistApi.addTask).toHaveBeenCalledWith({
                content: 'Test',
                description: undefined,
                priority: convertPriorityToNumber('p4'),
                dueString: undefined,
                deadlineDate: undefined,
                labels: [],
                projectId: undefined,
                sectionId: undefined,
                parentId: undefined,
                order: 0,
                isUncompletable: false,
            })

            expect(result.structuredContent.successCount).toBe(1)
        })
    })

    describe('batch limits', () => {
        it('should export MAX_TASKS_PER_OPERATION constant', () => {
            expect(MAX_TASKS_PER_OPERATION).toBe(25)
        })
    })
})
