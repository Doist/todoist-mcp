import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockProject } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { userResolver } from '../utils/user-resolver.js'
import { findProjectCollaborators } from './find-project-collaborators.js'

vi.mock('../utils/user-resolver.js', () => ({
    userResolver: {
        resolveUser: vi.fn(),
        getProjectCollaborators: vi.fn(),
        getAllCollaborators: vi.fn(),
    },
}))

const { FIND_PROJECT_COLLABORATORS } = ToolNames

const sharedProject = createMockProject({
    id: 'project-shared',
    name: 'Shared Project',
    isShared: true,
})

const unsharedProject = createMockProject({
    id: 'project-personal',
    name: 'Personal Project',
    isShared: false,
})

const carrie = { id: 'user-1', name: 'Carrie Anderson', email: 'carrie@example.com' }
const ernesto = { id: 'user-2', name: 'Ernesto Garcia', email: 'ernesto@doist.com' }
const dominique = { id: 'user-3', name: 'Dominique Rains', email: 'dominique@example.com' }

describe(`${FIND_PROJECT_COLLABORATORS} tool`, () => {
    let mockTodoistApi: Mocked<TodoistApi>

    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi = {
            getProject: vi.fn(),
            getUser: vi.fn().mockRejectedValue(new Error('getUser not stubbed in test')),
        } as unknown as Mocked<TodoistApi>
    })

    describe('with projectId (per-project search)', () => {
        it('returns all collaborators of the project when no searchTerm', async () => {
            mockTodoistApi.getProject.mockResolvedValue(sharedProject)
            vi.mocked(userResolver.getProjectCollaborators).mockResolvedValue([carrie, ernesto])

            const result = await findProjectCollaborators.execute(
                { projectId: sharedProject.id },
                mockTodoistApi,
            )

            expect(userResolver.getAllCollaborators).not.toHaveBeenCalled()
            expect(userResolver.getProjectCollaborators).toHaveBeenCalledWith(
                mockTodoistApi,
                sharedProject.id,
            )
            expect(result.structuredContent.collaborators).toEqual([carrie, ernesto])
            expect(result.structuredContent.projectInfo).toEqual({
                id: sharedProject.id,
                name: sharedProject.name,
                isShared: true,
            })
            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.structuredContent.totalAvailable).toBe(2)
        })

        it('filters collaborators by searchTerm (case-insensitive, partial)', async () => {
            mockTodoistApi.getProject.mockResolvedValue(sharedProject)
            vi.mocked(userResolver.getProjectCollaborators).mockResolvedValue([
                carrie,
                ernesto,
                dominique,
            ])

            const result = await findProjectCollaborators.execute(
                { projectId: sharedProject.id, searchTerm: 'ERNES' },
                mockTodoistApi,
            )

            expect(result.structuredContent.collaborators).toEqual([ernesto])
            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.totalAvailable).toBe(3)
            expect(result.textContent).toContain('matching "ERNES"')
        })

        it('returns empty result with helpful message for non-shared projects', async () => {
            mockTodoistApi.getProject.mockResolvedValue(unsharedProject)

            const result = await findProjectCollaborators.execute(
                { projectId: unsharedProject.id },
                mockTodoistApi,
            )

            expect(userResolver.getProjectCollaborators).not.toHaveBeenCalled()
            expect(result.structuredContent.collaborators).toEqual([])
            expect(result.structuredContent.projectInfo).toEqual({
                id: unsharedProject.id,
                name: unsharedProject.name,
                isShared: false,
            })
            expect(result.textContent).toContain('is not shared and has no collaborators')
        })

        it('throws when project lookup fails', async () => {
            mockTodoistApi.getProject.mockRejectedValue(new Error('Project not found'))

            await expect(
                findProjectCollaborators.execute({ projectId: 'missing' }, mockTodoistApi),
            ).rejects.toThrow('Failed to access project "missing"')
        })
    })

    describe('without projectId (workspace-wide search)', () => {
        it('searches all shared projects when only searchTerm is provided', async () => {
            vi.mocked(userResolver.getAllCollaborators).mockResolvedValue([
                carrie,
                ernesto,
                dominique,
            ])

            const result = await findProjectCollaborators.execute(
                { searchTerm: 'ernesto' },
                mockTodoistApi,
            )

            expect(userResolver.getAllCollaborators).toHaveBeenCalledWith(mockTodoistApi)
            expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
            expect(userResolver.getProjectCollaborators).not.toHaveBeenCalled()
            expect(result.structuredContent.collaborators).toEqual([ernesto])
            expect(result.structuredContent.projectInfo).toBeUndefined()
            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.totalAvailable).toBe(3)
            expect(result.textContent).toContain('Workspace users matching "ernesto"')
        })

        it('returns all workspace users when no searchTerm', async () => {
            vi.mocked(userResolver.getAllCollaborators).mockResolvedValue([carrie, ernesto])

            const result = await findProjectCollaborators.execute({}, mockTodoistApi)

            expect(result.structuredContent.collaborators).toEqual([carrie, ernesto])
            expect(result.structuredContent.projectInfo).toBeUndefined()
            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.textContent).toContain('Workspace users')
        })

        it('matches against email as well as name', async () => {
            vi.mocked(userResolver.getAllCollaborators).mockResolvedValue([carrie, ernesto])

            const result = await findProjectCollaborators.execute(
                { searchTerm: '@doist.com' },
                mockTodoistApi,
            )

            expect(result.structuredContent.collaborators).toEqual([ernesto])
        })

        it('returns helpful empty result when workspace has no shared projects and getUser fails', async () => {
            vi.mocked(userResolver.getAllCollaborators).mockResolvedValue([])

            const result = await findProjectCollaborators.execute(
                { searchTerm: 'anyone' },
                mockTodoistApi,
            )

            expect(result.structuredContent.collaborators).toEqual([])
            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.structuredContent.totalAvailable).toBe(0)
            expect(result.textContent).toContain('No users found')
        })

        it('prepends the authenticated user so personal accounts can look up themselves', async () => {
            vi.mocked(userResolver.getAllCollaborators).mockResolvedValue([])
            vi.mocked(mockTodoistApi.getUser).mockResolvedValue({
                id: 'me-id',
                fullName: 'Scott Lovegrove',
                email: 'scott@example.com',
            } as Awaited<ReturnType<TodoistApi['getUser']>>)

            const result = await findProjectCollaborators.execute(
                { searchTerm: 'Scott' },
                mockTodoistApi,
            )

            expect(result.structuredContent.collaborators).toEqual([
                { id: 'me-id', name: 'Scott Lovegrove', email: 'scott@example.com' },
            ])
            expect(result.structuredContent.totalAvailable).toBe(1)
        })

        it('does not duplicate the authenticated user when already a collaborator', async () => {
            vi.mocked(userResolver.getAllCollaborators).mockResolvedValue([
                { id: 'me-id', name: 'Scott Lovegrove', email: 'scott@example.com' },
                ernesto,
            ])
            vi.mocked(mockTodoistApi.getUser).mockResolvedValue({
                id: 'me-id',
                fullName: 'Scott Lovegrove',
                email: 'scott@example.com',
            } as Awaited<ReturnType<TodoistApi['getUser']>>)

            const result = await findProjectCollaborators.execute({}, mockTodoistApi)

            expect(result.structuredContent.collaborators).toHaveLength(2)
            expect(result.structuredContent.totalAvailable).toBe(2)
        })

        it('returns helpful empty result when search term has no matches', async () => {
            vi.mocked(userResolver.getAllCollaborators).mockResolvedValue([carrie, ernesto])

            const result = await findProjectCollaborators.execute(
                { searchTerm: 'nobody' },
                mockTodoistApi,
            )

            expect(result.structuredContent.collaborators).toEqual([])
            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.structuredContent.totalAvailable).toBe(2)
            expect(result.textContent).toContain('No users match "nobody"')
        })
    })
})
