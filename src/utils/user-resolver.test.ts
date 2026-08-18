import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import {
    BoundedTtlCache,
    SELF_USER_KEYWORD,
    UserResolver,
    resolveUserRefs,
    userResolver,
} from './user-resolver.js'

describe('BoundedTtlCache', () => {
    it('evicts the least recently used entry at capacity', () => {
        const cache = new BoundedTtlCache<string>(2, 1_000)

        cache.set('first', 'one')
        cache.set('second', 'two')
        expect(cache.get('first')).toBe('one')

        cache.set('third', 'three')

        expect(cache.size).toBe(2)
        expect(cache.get('first')).toBe('one')
        expect(cache.get('second')).toBeUndefined()
        expect(cache.get('third')).toBe('three')
    })

    it('removes expired entries when they are read', () => {
        vi.useFakeTimers()
        const cache = new BoundedTtlCache<string>(2, 1_000)
        cache.set('expired', 'value')

        vi.advanceTimersByTime(1_000)

        expect(cache.get('expired')).toBeUndefined()
        expect(cache.size).toBe(0)
        vi.useRealTimers()
    })

    it('prunes expired entries before evicting live entries at capacity', () => {
        vi.useFakeTimers()
        const cache = new BoundedTtlCache<string>(2, 1_000)
        cache.set('expired', 'old')
        vi.advanceTimersByTime(1_000)
        cache.set('live', 'current')
        cache.set('new', 'next')

        expect(cache.size).toBe(2)
        expect(cache.get('expired')).toBeUndefined()
        expect(cache.get('live')).toBe('current')
        expect(cache.get('new')).toBe('next')
        vi.useRealTimers()
    })
})

describe('UserResolver', () => {
    let resolver: UserResolver
    let mockClient: Mocked<TodoistApi>

    const mockCurrentUser = {
        id: '12345',
        fullName: 'Test User',
        email: 'test@example.com',
    }

    beforeEach(() => {
        resolver = new UserResolver()
        resolver.clearCache()

        mockClient = {
            getUser: vi.fn().mockResolvedValue(mockCurrentUser),
            getProjects: vi.fn().mockResolvedValue({ results: [], nextCursor: null }),
        } as unknown as Mocked<TodoistApi>
    })

    describe('SELF_USER_KEYWORD', () => {
        it('should export "me" as the self-user keyword', () => {
            expect(SELF_USER_KEYWORD).toBe('me')
        })
    })

    describe('"me" keyword resolution', () => {
        it('should resolve "me" to the current authenticated user', async () => {
            const result = await resolver.resolveUser(mockClient, 'me')

            expect(mockClient.getUser).toHaveBeenCalledOnce()
            expect(result).toEqual({
                userId: '12345',
                displayName: 'Test User',
                email: 'test@example.com',
            })
        })

        it('should resolve "Me" case-insensitively', async () => {
            const result = await resolver.resolveUser(mockClient, 'Me')

            expect(mockClient.getUser).toHaveBeenCalledOnce()
            expect(result).toEqual({
                userId: '12345',
                displayName: 'Test User',
                email: 'test@example.com',
            })
        })

        it('should not cache "me" resolution (cache is process-global)', async () => {
            await resolver.resolveUser(mockClient, 'me')
            await resolver.resolveUser(mockClient, 'me')

            expect(mockClient.getUser).toHaveBeenCalledTimes(2)
        })

        it('should return null if getUser fails', async () => {
            mockClient.getUser.mockRejectedValueOnce(new Error('Auth failed'))

            const result = await resolver.resolveUser(mockClient, 'me')

            expect(result).toBeNull()
        })
    })

    describe('getAllCollaborators', () => {
        it('paginates through every page of getProjects before collecting collaborators', async () => {
            const page1Project = { id: 'p1', isShared: true } as unknown
            const page2Project = { id: 'p2', isShared: true } as unknown
            const page3Project = { id: 'p3', isShared: false } as unknown

            mockClient.getProjects = vi
                .fn()
                .mockResolvedValueOnce({ results: [page1Project], nextCursor: 'cursor-2' })
                .mockResolvedValueOnce({ results: [page2Project], nextCursor: 'cursor-3' })
                .mockResolvedValueOnce({
                    results: [page3Project],
                    nextCursor: null,
                }) as unknown as typeof mockClient.getProjects

            mockClient.getProjectCollaborators = vi
                .fn()
                .mockImplementation(async (projectId: string) => ({
                    results: [
                        {
                            id: `user-${projectId}`,
                            name: `User ${projectId}`,
                            email: `${projectId}@example.com`,
                        },
                    ],
                    nextCursor: null,
                })) as unknown as typeof mockClient.getProjectCollaborators

            const collaborators = await resolver.getAllCollaborators(mockClient)

            expect(mockClient.getProjects).toHaveBeenCalledTimes(3)
            // Only the two shared projects should have been queried for collaborators.
            expect(mockClient.getProjectCollaborators).toHaveBeenCalledTimes(2)
            expect(collaborators.map((c) => c.id).sort()).toEqual(['user-p1', 'user-p2'])
            expect(mockClient.getUser).toHaveBeenCalledOnce()
        })

        it('keeps cached collaborators isolated between authenticated accounts', async () => {
            const clientA = {
                getUser: vi.fn().mockResolvedValue({
                    id: 'account-a',
                    fullName: 'Account A',
                    email: 'a@example.com',
                }),
                getProjects: vi.fn().mockResolvedValue({
                    results: [{ id: 'project-a', isShared: true }],
                    nextCursor: null,
                }),
                getProjectCollaborators: vi.fn().mockResolvedValue({
                    results: [{ id: 'collaborator-a', name: 'Alice', email: 'alice@example.com' }],
                    nextCursor: null,
                }),
            } as unknown as Mocked<TodoistApi>
            const clientB = {
                getUser: vi.fn().mockResolvedValue({
                    id: 'account-b',
                    fullName: 'Account B',
                    email: 'b@example.com',
                }),
                getProjects: vi.fn().mockResolvedValue({
                    results: [{ id: 'project-b', isShared: true }],
                    nextCursor: null,
                }),
                getProjectCollaborators: vi.fn().mockResolvedValue({
                    results: [{ id: 'collaborator-b', name: 'Bob', email: 'bob@example.com' }],
                    nextCursor: null,
                }),
            } as unknown as Mocked<TodoistApi>

            await expect(resolver.getAllCollaborators(clientA)).resolves.toMatchObject([
                { id: 'collaborator-a' },
            ])
            await expect(resolver.getAllCollaborators(clientB)).resolves.toMatchObject([
                { id: 'collaborator-b' },
            ])

            expect(clientB.getProjects).toHaveBeenCalledOnce()
            expect(clientB.getProjectCollaborators).toHaveBeenCalledWith('project-b')
        })
    })

    describe('resolveUser', () => {
        it('keeps cached user resolutions isolated between authenticated accounts', async () => {
            const clientA = {
                getUser: vi.fn().mockResolvedValue({
                    id: 'account-a',
                    fullName: 'Account A',
                    email: 'a@example.com',
                }),
                getProjects: vi.fn().mockResolvedValue({
                    results: [{ id: 'project-a', isShared: true }],
                    nextCursor: null,
                }),
                getProjectCollaborators: vi.fn().mockResolvedValue({
                    results: [{ id: 'alex-a', name: 'Alex', email: 'alex-a@example.com' }],
                    nextCursor: null,
                }),
            } as unknown as Mocked<TodoistApi>
            const clientB = {
                getUser: vi.fn().mockResolvedValue({
                    id: 'account-b',
                    fullName: 'Account B',
                    email: 'b@example.com',
                }),
                getProjects: vi.fn().mockResolvedValue({
                    results: [{ id: 'project-b', isShared: true }],
                    nextCursor: null,
                }),
                getProjectCollaborators: vi.fn().mockResolvedValue({
                    results: [{ id: 'alex-b', name: 'Alex', email: 'alex-b@example.com' }],
                    nextCursor: null,
                }),
            } as unknown as Mocked<TodoistApi>

            await expect(resolver.resolveUser(clientA, 'Alex')).resolves.toMatchObject({
                userId: 'alex-a',
            })
            await expect(resolver.resolveUser(clientB, 'Alex')).resolves.toMatchObject({
                userId: 'alex-b',
            })
        })

        it('resolves users without caching when the authenticated identity is unavailable', async () => {
            mockClient.getUser.mockRejectedValue(new Error('Auth unavailable'))
            mockClient.getProjects = vi.fn().mockResolvedValue({
                results: [{ id: 'project-1', isShared: true }],
                nextCursor: null,
            }) as unknown as typeof mockClient.getProjects
            mockClient.getProjectCollaborators = vi.fn().mockResolvedValue({
                results: [{ id: 'ada-id', name: 'Ada', email: 'ada@example.com' }],
                nextCursor: null,
            }) as unknown as typeof mockClient.getProjectCollaborators

            await expect(resolver.resolveUser(mockClient, 'Ada')).resolves.toEqual({
                userId: 'ada-id',
                displayName: 'Ada',
                email: 'ada@example.com',
            })
        })
    })
})

describe('resolveUserRefs', () => {
    const collaborators = [
        { id: '111', name: 'Ana Lovelace', email: 'ana@example.com' },
        { id: '222', name: 'Bo Turing', email: 'bo@example.com' },
    ]

    let mockClient: Mocked<TodoistApi>

    beforeEach(() => {
        userResolver.clearCache()
        mockClient = {
            getUser: vi
                .fn()
                .mockResolvedValue({ id: '999', fullName: 'Me', email: 'me@example.com' }),
            getProjects: vi
                .fn()
                .mockResolvedValue({ results: [{ id: 'p1', isShared: true }], nextCursor: null }),
            getProjectCollaborators: vi
                .fn()
                .mockResolvedValue({ results: collaborators, nextCursor: null }),
        } as unknown as Mocked<TodoistApi>
    })

    it('resolves IDs, emails, names and "me" in one pass', async () => {
        const resolved = await resolveUserRefs(mockClient, ['111', 'bo@example.com', 'me'])

        expect(resolved.map((user) => user.userId)).toEqual(['111', '222', '999'])
    })

    it('preserves input order and collapses duplicates', async () => {
        const resolved = await resolveUserRefs(mockClient, [
            'Bo Turing',
            'ana@example.com',
            'bo@example.com',
        ])

        expect(resolved.map((user) => user.userId)).toEqual(['222', '111'])
    })

    it('names every unresolvable reference in a single error', async () => {
        await expect(
            resolveUserRefs(mockClient, ['Ana Lovelace', 'Ghost', 'Phantom']),
        ).rejects.toThrow(
            'Could not find user(s): "Ghost", "Phantom". Make sure they are collaborators on a shared project.',
        )
    })

    it('resolves nothing for an empty list', async () => {
        await expect(resolveUserRefs(mockClient, [])).resolves.toEqual([])
    })

    it('looks a repeated reference up only once', async () => {
        await resolveUserRefs(mockClient, ['Ana Lovelace', 'ana lovelace', '  Ana Lovelace  '])

        // The collaborator lookup is shared, so a repeated name must not send
        // the whole project list off to be fetched again.
        expect(mockClient.getProjects).toHaveBeenCalledTimes(1)
    })

    it('reuses the warmed collaborator cache across distinct references', async () => {
        await resolveUserRefs(mockClient, ['Ana Lovelace', 'Bo Turing'])

        expect(mockClient.getProjects).toHaveBeenCalledTimes(1)
        expect(mockClient.getProjectCollaborators).toHaveBeenCalledTimes(1)
    })
})
