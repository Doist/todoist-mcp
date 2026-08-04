import type { TodoistApi, Workspace } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { listWorkspaces } from './list-workspaces.js'

// Mock the Todoist API
const mockTodoistApi = {
    getWorkspaces: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { LIST_WORKSPACES } = ToolNames

// Helper function to create a mock workspace with default values that can be overridden
function createMockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
    return {
        id: 'workspace-123',
        name: 'Test Workspace',
        plan: 'BUSINESS',
        role: 'ADMIN',
        inviteCode: 'abc123',
        isLinkSharingEnabled: true,
        isGuestAllowed: true,
        limits: { current: null, next: null },
        createdAt: new Date('2024-01-15T10:00:00Z'),
        creatorId: 'user-456',
        properties: {},
        ...overrides,
    }
}

describe(`${LIST_WORKSPACES} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should return workspaces when user has workspaces', async () => {
        const mockWorkspaces: Workspace[] = [
            createMockWorkspace({
                id: 'ws-1',
                name: 'Engineering Team',
                plan: 'BUSINESS',
                role: 'ADMIN',
            }),
            createMockWorkspace({
                id: 'ws-2',
                name: 'Marketing Team',
                plan: 'STARTER',
                role: 'MEMBER',
                isLinkSharingEnabled: false,
                isGuestAllowed: false,
            }),
        ]

        mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

        const result = await listWorkspaces.execute({}, mockTodoistApi)

        expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledWith()

        // Test text content contains expected information
        const textContent = result.textContent
        expect(textContent).toContain('# Workspaces')
        expect(textContent).toContain('Found 2 workspaces')
        expect(textContent).toContain('## Engineering Team')
        expect(textContent).toContain('**ID:** ws-1')
        expect(textContent).toContain('**Plan:** BUSINESS')
        expect(textContent).toContain('**Your Role:** ADMIN')
        expect(textContent).toContain('## Marketing Team')
        expect(textContent).toContain('**ID:** ws-2')
        expect(textContent).toContain('**Plan:** STARTER')
        expect(textContent).toContain('**Your Role:** MEMBER')
        expect(textContent).toContain('Link Sharing:** Enabled')
        expect(textContent).toContain('Link Sharing:** Disabled')

        // Test structured content
        const structuredContent = result.structuredContent
        expect(structuredContent).toEqual({
            type: 'workspaces',
            workspaces: [
                {
                    id: 'ws-1',
                    name: 'Engineering Team',
                    plan: 'BUSINESS',
                    role: 'ADMIN',
                    isLinkSharingEnabled: true,
                    isGuestAllowed: true,
                    createdAt: '2024-01-15T10:00:00.000Z',
                    creatorId: 'user-456',
                },
                {
                    id: 'ws-2',
                    name: 'Marketing Team',
                    plan: 'STARTER',
                    role: 'MEMBER',
                    isLinkSharingEnabled: false,
                    isGuestAllowed: false,
                    createdAt: '2024-01-15T10:00:00.000Z',
                    creatorId: 'user-456',
                },
            ],
            count: 2,
        })
    })

    it('should return empty array when user has no workspaces', async () => {
        mockTodoistApi.getWorkspaces.mockResolvedValue([])

        const result = await listWorkspaces.execute({}, mockTodoistApi)

        expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledWith()

        // Test text content
        const textContent = result.textContent
        expect(textContent).toContain('# Workspaces')
        expect(textContent).toContain('No workspaces found.')

        // Test structured content
        const structuredContent = result.structuredContent
        expect(structuredContent).toEqual({
            type: 'workspaces',
            workspaces: [],
            count: 0,
        })
    })

    it('should return singular "workspace" when user has one workspace', async () => {
        const mockWorkspaces: Workspace[] = [createMockWorkspace()]

        mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

        const result = await listWorkspaces.execute({}, mockTodoistApi)

        const textContent = result.textContent
        expect(textContent).toContain('Found 1 workspace:')
        expect(textContent).not.toContain('Found 1 workspaces')
    })

    it('should handle GUEST role correctly', async () => {
        const mockWorkspaces: Workspace[] = [
            createMockWorkspace({
                id: 'ws-guest',
                name: 'External Project',
                role: 'GUEST',
            }),
        ]

        mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

        const result = await listWorkspaces.execute({}, mockTodoistApi)

        const textContent = result.textContent
        expect(textContent).toContain('**Your Role:** GUEST')

        const structuredContent = result.structuredContent
        expect(structuredContent.workspaces[0]?.role).toBe('GUEST')
    })

    it('should propagate API errors', async () => {
        const apiError = new Error(TEST_ERRORS.API_UNAUTHORIZED)
        mockTodoistApi.getWorkspaces.mockRejectedValue(apiError)

        await expect(listWorkspaces.execute({}, mockTodoistApi)).rejects.toThrow(
            TEST_ERRORS.API_UNAUTHORIZED,
        )
    })
})
