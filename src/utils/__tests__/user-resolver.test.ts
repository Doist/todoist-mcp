import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { SELF_USER_KEYWORD, UserResolver } from '../user-resolver.js'

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
        })
    })

    describe('nullable collaborator emails', () => {
        beforeEach(() => {
            mockClient.getProjectCollaborators = vi.fn().mockResolvedValue({
                results: [{ id: 'user-hidden', name: 'Hidden User', email: null }],
                nextCursor: null,
            }) as unknown as typeof mockClient.getProjectCollaborators

            mockClient.getProjects = vi.fn().mockResolvedValue({
                results: [{ id: 'shared-project', isShared: true }],
                nextCursor: null,
            }) as unknown as typeof mockClient.getProjects
        })

        it('keeps collaborators whose email is hidden', async () => {
            const collaborators = await resolver.getProjectCollaborators(
                mockClient,
                'shared-project',
            )

            expect(collaborators).toEqual([{ id: 'user-hidden', name: 'Hidden User', email: null }])
        })

        it('resolves hidden-email collaborators by name', async () => {
            const result = await resolver.resolveUser(mockClient, 'Hidden User')

            expect(result).toEqual({
                userId: 'user-hidden',
                displayName: 'Hidden User',
                email: null,
            })
        })
    })
})
