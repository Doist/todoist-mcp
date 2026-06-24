import type { TodoistApi, WorkspaceInsights } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'
import { getWorkspaceInsights } from './get-workspace-insights.js'

vi.mock('../utils/workspace-resolver.js', () => ({
    workspaceResolver: {
        resolveWorkspace: vi.fn(),
    },
}))

const mockTodoistApi = {
    getWorkspaceInsights: vi.fn(),
} as unknown as Mocked<TodoistApi>

const mockResolveWorkspace = vi.mocked(workspaceResolver.resolveWorkspace)

function createMockInsights(overrides: Partial<WorkspaceInsights> = {}): WorkspaceInsights {
    return {
        folderId: null,
        projectInsights: [
            {
                projectId: 'proj-1',
                health: {
                    status: 'EXCELLENT',
                    isStale: false,
                    updateInProgress: false,
                },
                progress: {
                    projectId: 'proj-1',
                    completedCount: 20,
                    activeCount: 5,
                    progressPercent: 80,
                },
            },
            {
                projectId: 'proj-2',
                health: {
                    status: 'AT_RISK',
                    isStale: false,
                    updateInProgress: false,
                },
                progress: {
                    projectId: 'proj-2',
                    completedCount: 3,
                    activeCount: 12,
                    progressPercent: 20,
                },
            },
            {
                projectId: 'proj-3',
                health: null,
                progress: null,
            },
        ],
        ...overrides,
    }
}

describe('get-workspace-insights tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockResolveWorkspace.mockResolvedValue({
            workspaceId: 'ws-123',
            workspaceName: 'Engineering',
        })
    })

    it('should have correct tool metadata', () => {
        expect(getWorkspaceInsights.name).toBe(ToolNames.GET_WORKSPACE_INSIGHTS)
        expect(getWorkspaceInsights.annotations).toEqual({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        })
    })

    it('should return insights for workspace by name', async () => {
        const mockInsights = createMockInsights()
        mockTodoistApi.getWorkspaceInsights.mockResolvedValue(mockInsights)

        const result = await getWorkspaceInsights.execute(
            { workspaceIdOrName: 'Engineering' },
            mockTodoistApi,
        )

        expect(mockResolveWorkspace).toHaveBeenCalledWith(mockTodoistApi, 'Engineering')
        expect(mockTodoistApi.getWorkspaceInsights).toHaveBeenCalledWith('ws-123', {
            projectIds: undefined,
        })

        expect(result.structuredContent).toMatchObject({
            workspaceId: 'ws-123',
            workspaceName: 'Engineering',
            folderId: null,
            projectInsights: [
                {
                    projectId: 'proj-1',
                    health: { status: 'EXCELLENT', isStale: false, updateInProgress: false },
                    progress: { completedCount: 20, activeCount: 5, progressPercent: 80 },
                },
                {
                    projectId: 'proj-2',
                    health: { status: 'AT_RISK', isStale: false, updateInProgress: false },
                    progress: { completedCount: 3, activeCount: 12, progressPercent: 20 },
                },
                {
                    projectId: 'proj-3',
                    health: null,
                    progress: null,
                },
            ],
        })

        expect(result.textContent).toContain('Engineering')
        expect(result.textContent).toContain('**Projects:** 3')
    })

    it('should pass projectIds filter to API', async () => {
        mockTodoistApi.getWorkspaceInsights.mockResolvedValue(createMockInsights())

        await getWorkspaceInsights.execute(
            { workspaceIdOrName: 'ws-123', projectIds: ['proj-1', 'proj-2'] },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getWorkspaceInsights).toHaveBeenCalledWith('ws-123', {
            projectIds: ['proj-1', 'proj-2'],
        })
    })

    it('should handle null health and progress gracefully', async () => {
        const mockInsights = createMockInsights({
            projectInsights: [{ projectId: 'proj-1', health: null, progress: null }],
        })
        mockTodoistApi.getWorkspaceInsights.mockResolvedValue(mockInsights)

        const result = await getWorkspaceInsights.execute(
            { workspaceIdOrName: 'Engineering' },
            mockTodoistApi,
        )

        expect(result.structuredContent.projectInsights[0]).toMatchObject({
            projectId: 'proj-1',
            health: null,
            progress: null,
        })

        expect(result.textContent).toContain('status=N/A')
        expect(result.textContent).toContain('progress=N/A')
    })

    it('should propagate workspace resolution errors', async () => {
        mockResolveWorkspace.mockRejectedValue(
            new Error('No workspace found matching "Nonexistent"'),
        )

        await expect(
            getWorkspaceInsights.execute({ workspaceIdOrName: 'Nonexistent' }, mockTodoistApi),
        ).rejects.toThrow('No workspace found matching "Nonexistent"')
    })

    it('should propagate API errors', async () => {
        mockTodoistApi.getWorkspaceInsights.mockRejectedValue(new Error(TEST_ERRORS.API_RATE_LIMIT))

        await expect(
            getWorkspaceInsights.execute({ workspaceIdOrName: 'Engineering' }, mockTodoistApi),
        ).rejects.toThrow(TEST_ERRORS.API_RATE_LIMIT)
    })
})
