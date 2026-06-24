import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockProject } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { projectManagement } from './project-management.js'

const mockTodoistApi = {
    archiveProject: vi.fn(),
    unarchiveProject: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { PROJECT_MANAGEMENT } = ToolNames

describe(`${PROJECT_MANAGEMENT} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
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
})
