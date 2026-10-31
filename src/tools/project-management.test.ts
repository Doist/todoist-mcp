import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import {
    createMockApiResponse,
    createMockProject,
    createMockWorkspaceProject,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { projectManagement } from './project-management.js'

const mockTodoistApi = {
    archiveProject: vi.fn(),
    unarchiveProject: vi.fn(),
    getProject: vi.fn(),
    getProjects: vi.fn(),
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

function mockPersonalProjectCapacity({
    maxProjects,
    activeCount,
}: {
    maxProjects: number
    activeCount: number
}) {
    mockTodoistApi.sync.mockResolvedValue({
        userPlanLimits: { current: { maxProjects }, next: { maxProjects: 300 } },
    })
    mockTodoistApi.getProjects.mockResolvedValue(
        createMockApiResponse(
            Array.from({ length: activeCount }, (_, index) =>
                createMockProject({ id: `existing-${index}` }),
            ),
        ),
    )
}

const { PROJECT_MANAGEMENT } = ToolNames

describe(`${PROJECT_MANAGEMENT} tool`, () => {
    beforeEach(() => {
        vi.resetAllMocks()
        mockTodoistApi.getProject.mockResolvedValue(createMockProject({ isArchived: true }))
        mockPersonalProjectCapacity({ maxProjects: 5, activeCount: 4 })
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
    })

    describe('personal project limit', () => {
        it('does not unarchive a personal project when the account is at its limit', async () => {
            mockPersonalProjectCapacity({ maxProjects: 5, activeCount: 5 })

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
            mockTodoistApi.sync.mockResolvedValue({ userPlanLimits: { current: {}, next: null } })
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
            mockPersonalProjectCapacity({ maxProjects: 5, activeCount: 5 })
            mockTodoistApi.getProject.mockResolvedValue(project)
            mockTodoistApi.unarchiveProject.mockResolvedValue(project)

            await projectManagement.execute(
                { action: 'unarchive', projectId: project.id },
                mockTodoistApi,
            )

            expect(mockTodoistApi.sync).not.toHaveBeenCalled()
            expect(mockTodoistApi.unarchiveProject).toHaveBeenCalledWith(project.id)
        })

        it('does not check the limit when archiving', async () => {
            mockPersonalProjectCapacity({ maxProjects: 5, activeCount: 5 })
            mockTodoistApi.archiveProject.mockResolvedValue(createMockProject())

            await projectManagement.execute(
                { action: 'archive', projectId: 'proj-active' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.sync).not.toHaveBeenCalled()
        })
    })
})
