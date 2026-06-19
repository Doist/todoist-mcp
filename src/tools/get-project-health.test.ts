import {
    HEALTH_STATUSES,
    type ProjectHealth,
    type ProjectHealthContext,
    type ProjectProgress,
    type TodoistApi,
} from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { getProjectHealth } from './get-project-health.js'

const mockTodoistApi = {
    getProjectProgress: vi.fn(),
    getProjectHealth: vi.fn(),
    getProjectHealthContext: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { GET_PROJECT_HEALTH } = ToolNames

function createMockProgress(overrides: Partial<ProjectProgress> = {}): ProjectProgress {
    return {
        projectId: 'proj-123',
        completedCount: 15,
        activeCount: 10,
        progressPercent: 60,
        ...overrides,
    }
}

function createMockHealth(overrides: Partial<ProjectHealth> = {}): ProjectHealth {
    return {
        status: 'ON_TRACK',
        description: 'Project is progressing well.',
        descriptionSummary: 'On track',
        taskRecommendations: null,
        projectId: 'proj-123',
        updatedAt: new Date('2026-03-28T10:00:00Z'),
        isStale: false,
        updateInProgress: false,
        ...overrides,
    }
}

function createMockHealthContext(
    overrides: Partial<ProjectHealthContext> = {},
): ProjectHealthContext {
    return {
        projectId: 'proj-123',
        projectName: 'Test Project',
        projectDescription: 'A test project for health checks',
        projectMetrics: {
            totalTasks: 25,
            completedTasks: 15,
            overdueTasks: 3,
            tasksCreatedThisWeek: 5,
            tasksCompletedThisWeek: 4,
            averageCompletionTime: 2.5,
        },
        tasks: [
            {
                id: 'task-1',
                content: 'Fix the login bug',
                priority: '1',
                due: '2026-03-30',
                deadline: null,
                isCompleted: false,
                createdAt: new Date('2026-03-25T10:00:00Z'),
                updatedAt: new Date('2026-03-27T10:00:00Z'),
                completedAt: null,
                completedByUid: null,
                labels: ['bug'],
            },
            {
                id: 'task-2',
                content: 'Write documentation',
                priority: '3',
                due: null,
                deadline: null,
                isCompleted: true,
                createdAt: new Date('2026-03-20T10:00:00Z'),
                updatedAt: new Date('2026-03-26T10:00:00Z'),
                completedAt: new Date('2026-03-26T10:00:00Z'),
                completedByUid: 'user-1',
                labels: [],
            },
        ],
        ...overrides,
    }
}

describe('get-project-health tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should have correct tool metadata', () => {
        expect(getProjectHealth.name).toBe(GET_PROJECT_HEALTH)
        expect(getProjectHealth.annotations).toEqual({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        })
    })

    it('should return combined progress and health data', async () => {
        const mockProgress = createMockProgress()
        const mockHealth = createMockHealth()

        mockTodoistApi.getProjectProgress.mockResolvedValue(mockProgress)
        mockTodoistApi.getProjectHealth.mockResolvedValue(mockHealth)

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: false },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProjectProgress).toHaveBeenCalledWith('proj-123')
        expect(mockTodoistApi.getProjectHealth).toHaveBeenCalledWith('proj-123')
        expect(mockTodoistApi.getProjectHealthContext).not.toHaveBeenCalled()

        expect(result.structuredContent).toMatchObject({
            projectId: 'proj-123',
            progress: {
                completedCount: 15,
                activeCount: 10,
                progressPercent: 60,
            },
            health: {
                status: 'ON_TRACK',
                description: 'Project is progressing well.',
                isStale: false,
                updateInProgress: false,
            },
        })

        const structured = result.structuredContent as Record<string, unknown>
        expect(structured.context).toBeUndefined()
    })

    it('should include context when includeContext is true', async () => {
        const mockProgress = createMockProgress()
        const mockHealth = createMockHealth()
        const mockContext = createMockHealthContext()

        mockTodoistApi.getProjectProgress.mockResolvedValue(mockProgress)
        mockTodoistApi.getProjectHealth.mockResolvedValue(mockHealth)
        mockTodoistApi.getProjectHealthContext.mockResolvedValue(mockContext)

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: true },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProjectHealthContext).toHaveBeenCalledWith('proj-123')

        const structured = result.structuredContent as Record<string, unknown>
        expect(structured).toHaveProperty('context')

        const context = structured.context as Record<string, unknown>
        expect(context).toMatchObject({
            projectDescription: 'A test project for health checks',
            projectMetrics: {
                totalTasks: 25,
                completedTasks: 15,
                overdueTasks: 3,
                tasksCreatedThisWeek: 5,
                tasksCompletedThisWeek: 4,
                averageCompletionTime: 2.5,
            },
        })

        const tasks = context.tasks as Array<Record<string, unknown>>
        expect(tasks).toHaveLength(2)
        expect(tasks[0]).toMatchObject({
            id: 'task-1',
            content: 'Fix the login bug',
            priority: '1',
            due: '2026-03-30',
            isCompleted: false,
            labels: ['bug'],
        })
    })

    it('should use project name from context when available', async () => {
        const mockProgress = createMockProgress()
        const mockHealth = createMockHealth()
        const mockContext = createMockHealthContext({ projectName: 'My Named Project' })

        mockTodoistApi.getProjectProgress.mockResolvedValue(mockProgress)
        mockTodoistApi.getProjectHealth.mockResolvedValue(mockHealth)
        mockTodoistApi.getProjectHealthContext.mockResolvedValue(mockContext)

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: true },
            mockTodoistApi,
        )

        expect(result.structuredContent).toMatchObject({ projectName: 'My Named Project' })
        expect(result.textContent).toContain('My Named Project')
    })

    it('should fall back to project ID when context is not included', async () => {
        const mockProgress = createMockProgress()
        const mockHealth = createMockHealth()

        mockTodoistApi.getProjectProgress.mockResolvedValue(mockProgress)
        mockTodoistApi.getProjectHealth.mockResolvedValue(mockHealth)

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: false },
            mockTodoistApi,
        )

        expect(result.structuredContent).toMatchObject({ projectName: 'Project proj-123' })
    })

    it.each(HEALTH_STATUSES)('should handle %s health status in text output', async (status) => {
        mockTodoistApi.getProjectProgress.mockResolvedValue(createMockProgress())
        mockTodoistApi.getProjectHealth.mockResolvedValue(createMockHealth({ status }))

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: false },
            mockTodoistApi,
        )

        expect(result.textContent).toContain(`**Status:** ${status}`)
        expect(result.structuredContent).toMatchObject({
            health: { status },
        })
    })

    it('should indicate stale health data in text output', async () => {
        mockTodoistApi.getProjectProgress.mockResolvedValue(createMockProgress())
        mockTodoistApi.getProjectHealth.mockResolvedValue(createMockHealth({ isStale: true }))

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: false },
            mockTodoistApi,
        )

        expect(result.textContent).toContain('Health data is stale')
        expect(result.structuredContent).toMatchObject({
            health: { isStale: true },
        })
    })

    it('should indicate update in progress in text output', async () => {
        mockTodoistApi.getProjectProgress.mockResolvedValue(createMockProgress())
        mockTodoistApi.getProjectHealth.mockResolvedValue(
            createMockHealth({ updateInProgress: true }),
        )

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: false },
            mockTodoistApi,
        )

        expect(result.textContent).toContain('update is currently in progress')
        expect(result.structuredContent).toMatchObject({
            health: { updateInProgress: true },
        })
    })

    it('should include task recommendations in output', async () => {
        const recommendations = [
            { taskId: 'task-1', recommendation: 'Break this task into subtasks' },
            { taskId: 'task-2', recommendation: 'Set a due date' },
        ]

        mockTodoistApi.getProjectProgress.mockResolvedValue(createMockProgress())
        mockTodoistApi.getProjectHealth.mockResolvedValue(
            createMockHealth({ taskRecommendations: recommendations }),
        )

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: false },
            mockTodoistApi,
        )

        expect(result.textContent).toContain('Task Recommendations')
        expect(result.textContent).toContain('Break this task into subtasks')
        expect(result.textContent).toContain('Set a due date')
        expect(result.structuredContent).toMatchObject({
            health: { taskRecommendations: recommendations },
        })
    })

    it('should handle null average completion time in context', async () => {
        const mockContext = createMockHealthContext({
            projectMetrics: {
                totalTasks: 5,
                completedTasks: 0,
                overdueTasks: 0,
                tasksCreatedThisWeek: 5,
                tasksCompletedThisWeek: 0,
                averageCompletionTime: null,
            },
        })

        mockTodoistApi.getProjectProgress.mockResolvedValue(createMockProgress())
        mockTodoistApi.getProjectHealth.mockResolvedValue(createMockHealth())
        mockTodoistApi.getProjectHealthContext.mockResolvedValue(mockContext)

        const result = await getProjectHealth.execute(
            { projectId: 'proj-123', includeContext: true },
            mockTodoistApi,
        )

        expect(result.textContent).not.toContain('Avg Completion Time')
    })

    it('should propagate API errors', async () => {
        mockTodoistApi.getProjectProgress.mockRejectedValue(new Error(TEST_ERRORS.API_RATE_LIMIT))
        mockTodoistApi.getProjectHealth.mockResolvedValue(createMockHealth())

        await expect(
            getProjectHealth.execute(
                { projectId: 'proj-123', includeContext: false },
                mockTodoistApi,
            ),
        ).rejects.toThrow(TEST_ERRORS.API_RATE_LIMIT)
    })
})
