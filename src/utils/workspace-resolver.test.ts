import type { TodoistApi, Workspace } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { looksLikeWorkspaceId, WorkspaceResolver } from './workspace-resolver.js'

function createMockClient(workspaces: Workspace[] = []): Mocked<TodoistApi> {
    return {
        getWorkspaces: vi.fn().mockResolvedValue(workspaces),
    } as unknown as Mocked<TodoistApi>
}

const mockTodoistApi = createMockClient()

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

    afterEach(() => {
        vi.restoreAllMocks()
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
        it('shares in-flight requests only within the same client', async () => {
            const workspaces = [
                createMockWorkspace({ id: '111', name: 'Engineering' }),
                createMockWorkspace({ id: '222', name: 'Marketing' }),
            ]
            const otherClient = createMockClient()
            let resolveWorkspaces: (value: Workspace[]) => void = () => undefined
            let resolveOtherWorkspaces: (value: Workspace[]) => void = () => undefined
            mockTodoistApi.getWorkspaces.mockReturnValue(
                new Promise<Workspace[]>((resolve) => {
                    resolveWorkspaces = resolve
                }),
            )
            otherClient.getWorkspaces.mockReturnValue(
                new Promise<Workspace[]>((resolve) => {
                    resolveOtherWorkspaces = resolve
                }),
            )

            const engineering = resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            const marketing = resolver.resolveWorkspace(mockTodoistApi, 'Marketing')
            const otherEngineering = resolver.resolveWorkspace(otherClient, 'Engineering')

            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(1)
            expect(otherClient.getWorkspaces).toHaveBeenCalledTimes(1)

            resolveOtherWorkspaces([createMockWorkspace({ id: '333', name: 'Engineering' })])
            await expect(otherEngineering).resolves.toEqual({
                workspaceId: '333',
                workspaceName: 'Engineering',
            })
            resolveWorkspaces(workspaces)
            await expect(engineering).resolves.toEqual({
                workspaceId: '111',
                workspaceName: 'Engineering',
            })
            await expect(marketing).resolves.toEqual({
                workspaceId: '222',
                workspaceName: 'Marketing',
            })
        })

        it('should isolate cached workspaces by client without re-fetching', async () => {
            mockTodoistApi.getWorkspaces.mockResolvedValue([
                createMockWorkspace({ id: '111', name: 'Engineering' }),
            ])
            const otherClient = createMockClient([
                createMockWorkspace({ id: '333', name: 'Engineering' }),
            ])

            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            await expect(resolver.resolveWorkspace(otherClient, 'Engineering')).resolves.toEqual({
                workspaceId: '333',
                workspaceName: 'Engineering',
            })
            await expect(
                resolver.resolveWorkspace(mockTodoistApi, 'Engineering'),
            ).resolves.toEqual({
                workspaceId: '111',
                workspaceName: 'Engineering',
            })

            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(1)
            expect(otherClient.getWorkspaces).toHaveBeenCalledTimes(1)
        })

        it('should expire clients independently and retry a failed refresh', async () => {
            const now = vi.spyOn(Date, 'now').mockReturnValue(0)
            const otherClient = createMockClient()
            otherClient.getWorkspaces
                .mockResolvedValueOnce([createMockWorkspace({ id: '333', name: 'Engineering' })])
                .mockRejectedValueOnce(new Error('Workspace fetch failed'))
                .mockResolvedValue([createMockWorkspace({ id: '444', name: 'Engineering' })])
            mockTodoistApi.getWorkspaces.mockResolvedValue([
                createMockWorkspace({ id: '111', name: 'Engineering' }),
            ])

            await resolver.resolveWorkspace(otherClient, 'Engineering')
            now.mockReturnValue(60_000)
            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')

            now.mockReturnValue(5 * 60 * 1000)
            await expect(resolver.resolveWorkspace(otherClient, 'Engineering')).rejects.toThrow(
                'Workspace fetch failed',
            )
            await expect(resolver.resolveWorkspace(otherClient, 'Engineering')).resolves.toEqual({
                workspaceId: '444',
                workspaceName: 'Engineering',
            })
            await expect(
                resolver.resolveWorkspace(mockTodoistApi, 'Engineering'),
            ).resolves.toEqual({
                workspaceId: '111',
                workspaceName: 'Engineering',
            })
            expect(otherClient.getWorkspaces).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(1)
        })

        it('should re-fetch all clients after clearCache', async () => {
            mockTodoistApi.getWorkspaces.mockResolvedValue([
                createMockWorkspace({ id: '111', name: 'Engineering' }),
            ])
            const otherClient = createMockClient([
                createMockWorkspace({ id: '333', name: 'Marketing' }),
            ])

            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            await resolver.resolveWorkspace(otherClient, 'Marketing')
            resolver.clearCache()
            await resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            await resolver.resolveWorkspace(otherClient, 'Marketing')

            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(2)
            expect(otherClient.getWorkspaces).toHaveBeenCalledTimes(2)
        })

        it('should detach pre-clear requests from new cache and in-flight state', async () => {
            let resolveOldWorkspaces: (value: Workspace[]) => void = () => undefined
            let resolveNewWorkspaces: (value: Workspace[]) => void = () => undefined
            mockTodoistApi.getWorkspaces
                .mockReturnValueOnce(
                    new Promise<Workspace[]>((resolve) => {
                        resolveOldWorkspaces = resolve
                    }),
                )
                .mockReturnValueOnce(
                    new Promise<Workspace[]>((resolve) => {
                        resolveNewWorkspaces = resolve
                    }),
                )

            const oldRequest = resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            resolver.clearCache()
            const newRequest = resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(2)

            resolveOldWorkspaces([createMockWorkspace({ id: '111', name: 'Engineering' })])
            await oldRequest
            const concurrentRequest = resolver.resolveWorkspace(mockTodoistApi, 'Engineering')
            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(2)

            resolveNewWorkspaces([createMockWorkspace({ id: '333', name: 'Engineering' })])
            for (const request of [newRequest, concurrentRequest]) {
                await expect(request).resolves.toEqual({
                    workspaceId: '333',
                    workspaceName: 'Engineering',
                })
            }
            await expect(
                resolver.resolveWorkspace(mockTodoistApi, 'Engineering'),
            ).resolves.toEqual({
                workspaceId: '333',
                workspaceName: 'Engineering',
            })
            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(2)
        })
    })
})
