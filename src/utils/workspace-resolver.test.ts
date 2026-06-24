import type { TodoistApi, Workspace } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { looksLikeWorkspaceId, WorkspaceResolver } from './workspace-resolver.js'

const mockTodoistApi = {
    getWorkspaces: vi.fn(),
} as unknown as Mocked<TodoistApi>

function createMockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
    return {
        id: '100123',
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

describe('looksLikeWorkspaceId', () => {
    it('should return true for purely numeric strings', () => {
        expect(looksLikeWorkspaceId('12345')).toBe(true)
        expect(looksLikeWorkspaceId('0')).toBe(true)
        expect(looksLikeWorkspaceId('9999999999')).toBe(true)
    })

    it('should return false for non-numeric strings', () => {
        expect(looksLikeWorkspaceId('abc')).toBe(false)
        expect(looksLikeWorkspaceId('123abc')).toBe(false)
        expect(looksLikeWorkspaceId('My Workspace')).toBe(false)
        expect(looksLikeWorkspaceId(' 123')).toBe(false)
        expect(looksLikeWorkspaceId('')).toBe(false)
    })
})

describe('WorkspaceResolver', () => {
    let resolver: WorkspaceResolver

    beforeEach(() => {
        vi.clearAllMocks()
        resolver = new WorkspaceResolver()
    })

    describe('resolveWorkspace', () => {
        it('should resolve by ID when workspace exists', async () => {
            const workspaces = [
                createMockWorkspace({ id: '111', name: 'Engineering' }),
                createMockWorkspace({ id: '222', name: 'Marketing' }),
            ]
            mockTodoistApi.getWorkspaces.mockResolvedValue(workspaces)

            const result = await resolver.resolveWorkspace(mockTodoistApi, '111')
            expect(result).toEqual({ workspaceId: '111', workspaceName: 'Engineering' })
        })

        it('should pass through numeric ID when workspace not found', async () => {
            mockTodoistApi.getWorkspaces.mockResolvedValue([
                createMockWorkspace({ id: '111', name: 'Engineering' }),
            ])

            const result = await resolver.resolveWorkspace(mockTodoistApi, '999')
            expect(result).toEqual({ workspaceId: '999', workspaceName: '999' })
        })

        it('should resolve by exact case-insensitive name', async () => {
            const workspaces = [
                createMockWorkspace({ id: '111', name: 'Engineering Team' }),
                createMockWorkspace({ id: '222', name: 'Marketing Team' }),
            ]
            mockTodoistApi.getWorkspaces.mockResolvedValue(workspaces)

            const result = await resolver.resolveWorkspace(mockTodoistApi, 'engineering team')
            expect(result).toEqual({ workspaceId: '111', workspaceName: 'Engineering Team' })
        })

        it('should resolve by unique partial name match', async () => {
            const workspaces = [
                createMockWorkspace({ id: '111', name: 'Engineering Team' }),
                createMockWorkspace({ id: '222', name: 'Marketing Team' }),
            ]
            mockTodoistApi.getWorkspaces.mockResolvedValue(workspaces)

            const result = await resolver.resolveWorkspace(mockTodoistApi, 'Engineer')
            expect(result).toEqual({ workspaceId: '111', workspaceName: 'Engineering Team' })
        })

        it('should throw on ambiguous partial name match', async () => {
            const workspaces = [
                createMockWorkspace({ id: '111', name: 'Engineering Team' }),
                createMockWorkspace({ id: '222', name: 'Marketing Team' }),
            ]
            mockTodoistApi.getWorkspaces.mockResolvedValue(workspaces)

            await expect(resolver.resolveWorkspace(mockTodoistApi, 'Team')).rejects.toThrow(
                /Ambiguous workspace reference "Team"/,
            )
        })

        it('should throw when workspace name not found', async () => {
            mockTodoistApi.getWorkspaces.mockResolvedValue([
                createMockWorkspace({ id: '111', name: 'Engineering' }),
            ])

            await expect(resolver.resolveWorkspace(mockTodoistApi, 'Nonexistent')).rejects.toThrow(
                /Workspace "Nonexistent" not found/,
            )
        })

        it('should throw on empty input', async () => {
            await expect(resolver.resolveWorkspace(mockTodoistApi, '')).rejects.toThrow(
                'Workspace reference cannot be empty',
            )
            await expect(resolver.resolveWorkspace(mockTodoistApi, '   ')).rejects.toThrow(
                'Workspace reference cannot be empty',
            )
        })

        it('should list up to 5 matches in ambiguous error', async () => {
            const workspaces = Array.from({ length: 7 }, (_, i) =>
                createMockWorkspace({ id: `${i}`, name: `Team ${i}` }),
            )
            mockTodoistApi.getWorkspaces.mockResolvedValue(workspaces)

            await expect(resolver.resolveWorkspace(mockTodoistApi, 'Team')).rejects.toThrow(
                /and 2 more/,
            )
        })
    })

    describe('caching', () => {
        it('should not re-fetch workspaces on second call', async () => {
            const workspaces = [createMockWorkspace({ id: '111', name: 'Engineering' })]
            mockTodoistApi.getWorkspaces.mockResolvedValue(workspaces)

            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')

            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(1)
        })

        it('should re-fetch after clearCache', async () => {
            const workspaces = [createMockWorkspace({ id: '111', name: 'Engineering' })]
            mockTodoistApi.getWorkspaces.mockResolvedValue(workspaces)

            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            resolver.clearCache()
            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')

            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(2)
        })
    })
})
