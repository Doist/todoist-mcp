import type { TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { formatToolExecutionError } from '../tool-execution-error.js'
import {
    createMockProject,
    createMockWorkspaceProject,
    mockPersonalProjectCapacity,
    mockUnjoinedWorkspaceProject,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { projectManagement } from './project-management.js'

const mockTodoistApi = {
    archiveProject: vi.fn(),
    unarchiveProject: vi.fn(),
    joinProject: vi.fn(),
    getProject: vi.fn(),
    getPersonalProjectCapacity: vi.fn(),
    getWorkspaces: vi.fn(),
    getWorkspaceActiveProjects: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { PROJECT_MANAGEMENT } = ToolNames

describe(`${PROJECT_MANAGEMENT} tool`, () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mockTodoistApi.getProject.mockResolvedValue(createMockProject({ isArchived: true }))
        mockPersonalProjectCapacity(mockTodoistApi, { maxProjects: 5, activeCount: 4 })
    })

    describe('archiving projects', () => {
        it('should archive a project by ID', async () => {
            const mockProject = createMockProject({
                id: '6cfCcrrCFg2xP94Q',
                name: 'My Project',
            })
            mockTodoistApi.archiveProject.mockResolvedValue(mockProject)

            const result = await projectManagement.execute(
                { action: 'archive', projectId: '6cfCcrrCFg2xP94Q' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.archiveProject).toHaveBeenCalledWith('6cfCcrrCFg2xP94Q')
            expect(mockTodoistApi.unarchiveProject).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Archived project: My Project (id=6cfCcrrCFg2xP94Q)')
            expect(result.structuredContent).toEqual({
                project: expect.objectContaining({
                    id: '6cfCcrrCFg2xP94Q',
                    name: 'My Project',
                }),
                success: true,
            })
        })

        it('should propagate archive errors', async () => {
            const apiError = new Error('API Error: Project not found')
            mockTodoistApi.archiveProject.mockRejectedValue(apiError)

            await expect(
                projectManagement.execute(
                    { action: 'archive', projectId: 'non-existent' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Project not found')
        })
    })

    describe('unarchiving projects', () => {
        it('should unarchive a project by ID', async () => {
            const mockProject = createMockProject({
                id: 'proj-archived',
                name: 'Archived Project',
            })
            mockTodoistApi.unarchiveProject.mockResolvedValue(mockProject)

            const result = await projectManagement.execute(
                { action: 'unarchive', projectId: 'proj-archived' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.unarchiveProject).toHaveBeenCalledWith('proj-archived')
            expect(mockTodoistApi.archiveProject).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Unarchived project: Archived Project (id=proj-archived)')
            expect(result.structuredContent).toEqual({
                project: expect.objectContaining({
                    id: 'proj-archived',
                    name: 'Archived Project',
                }),
                success: true,
            })
        })

        it('should propagate unarchive errors', async () => {
            const apiError = new Error('API Error: Cannot unarchive project')
            mockTodoistApi.unarchiveProject.mockRejectedValue(apiError)

            await expect(
                projectManagement.execute(
                    { action: 'unarchive', projectId: 'invalid-id' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Cannot unarchive project')
        })

        it('should explain a 404 for a workspace project the user has not joined', async () => {
            const expected = mockUnjoinedWorkspaceProject(mockTodoistApi)

            const error = await projectManagement
                .execute({ action: 'unarchive', projectId: 'unjoined-project-id' }, mockTodoistApi)
                .catch((caught: unknown) => caught)

            expect(formatToolExecutionError(error)).toBe(expected)
            expect(mockTodoistApi.unarchiveProject).not.toHaveBeenCalled()
        })
    })

    describe('joining projects', () => {
        it('should join a workspace project by ID', async () => {
            const joined = createMockWorkspaceProject({
                id: 'sales-pipeline-id',
                name: 'Sales Pipeline',
                workspaceId: 'ws-acme',
            })
            mockTodoistApi.joinProject.mockResolvedValue({
                project: joined,
                tasks: [],
                sections: [],
                comments: [],
                collaborators: [],
                collaboratorStates: [],
                folder: null,
                subprojects: [],
            })

            const result = await projectManagement.execute(
                { action: 'join', projectId: 'sales-pipeline-id' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.joinProject).toHaveBeenCalledWith('sales-pipeline-id')
            expect(mockTodoistApi.archiveProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.unarchiveProject).not.toHaveBeenCalled()
            // Joining a workspace project doesn't count towards the personal limit.
            expect(mockTodoistApi.getPersonalProjectCapacity).not.toHaveBeenCalled()
            expect(result.textContent).toBe('Joined project: Sales Pipeline (id=sales-pipeline-id)')
            expect(result.structuredContent).toEqual({
                project: expect.objectContaining({
                    id: 'sales-pipeline-id',
                    name: 'Sales Pipeline',
                    workspaceId: 'ws-acme',
                }),
                success: true,
            })
        })

        it('should propagate join errors', async () => {
            mockTodoistApi.joinProject.mockRejectedValue(new Error('API Error: Forbidden'))

            await expect(
                projectManagement.execute(
                    { action: 'join', projectId: 'restricted-id' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Forbidden')
        })
    })

    describe('personal project limit', () => {
        it('does not unarchive a personal project when the account is at its limit', async () => {
            mockPersonalProjectCapacity(mockTodoistApi, { maxProjects: 5, activeCount: 5 })

            await expect(
                projectManagement.execute(
                    { action: 'unarchive', projectId: 'proj-archived' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Your account has reached its limit of 5 active personal projects. This project was not unarchived.',
            )
            expect(mockTodoistApi.getProject).toHaveBeenCalledWith('proj-archived')
            expect(mockTodoistApi.unarchiveProject).not.toHaveBeenCalled()
        })

        it('does not unarchive a personal project when the limit cannot be verified', async () => {
            mockTodoistApi.getPersonalProjectCapacity.mockRejectedValue(
                new Error('Could not load limits'),
            )
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

            await expect(
                projectManagement.execute(
                    { action: 'unarchive', projectId: 'proj-archived' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(
                'Could not verify your personal project limit. This project was not unarchived. Retry later.',
            )
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                `${PROJECT_MANAGEMENT}: could not load personal project limit`,
                expect.any(Error),
            )
            consoleErrorSpy.mockRestore()
            expect(mockTodoistApi.unarchiveProject).not.toHaveBeenCalled()
        })

        it.each([
            {
                kind: 'a workspace project',
                project: createMockWorkspaceProject({ isArchived: true }),
            },
            {
                kind: 'an active personal project',
                project: createMockProject({ isArchived: false }),
            },
        ])('does not check the limit when unarchiving $kind', async ({ project }) => {
            mockPersonalProjectCapacity(mockTodoistApi, { maxProjects: 5, activeCount: 5 })
            mockTodoistApi.getProject.mockResolvedValue(project)
            mockTodoistApi.unarchiveProject.mockResolvedValue(project)

            await projectManagement.execute(
                { action: 'unarchive', projectId: project.id },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getPersonalProjectCapacity).not.toHaveBeenCalled()
            expect(mockTodoistApi.unarchiveProject).toHaveBeenCalledWith(project.id)
        })

        it('does not check the limit when archiving', async () => {
            mockPersonalProjectCapacity(mockTodoistApi, { maxProjects: 5, activeCount: 5 })
            mockTodoistApi.archiveProject.mockResolvedValue(createMockProject())

            await projectManagement.execute(
                { action: 'archive', projectId: 'proj-active' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.getPersonalProjectCapacity).not.toHaveBeenCalled()
        })
    })
})
