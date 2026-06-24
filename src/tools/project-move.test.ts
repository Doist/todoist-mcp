import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockProject, createMockWorkspaceProject, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { projectMove } from './project-move.js'

const mockTodoistApi = {
    moveProjectToWorkspace: vi.fn(),
    moveProjectToPersonal: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { PROJECT_MOVE } = ToolNames

describe(`${PROJECT_MOVE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('move to workspace', () => {
        it('should move a project to a workspace with projectId and workspaceId only', async () => {
            const mockProject = createMockWorkspaceProject({
                id: '6cfCcrrCFg2xP94Q',
                name: 'My Project',
                workspaceId: TEST_IDS.WORKSPACE_1,
            })
            mockTodoistApi.moveProjectToWorkspace.mockResolvedValue(mockProject)

            const result = await projectMove.execute(
                {
                    action: 'move-to-workspace',
                    projectId: '6cfCcrrCFg2xP94Q',
                    workspaceId: TEST_IDS.WORKSPACE_1,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveProjectToWorkspace).toHaveBeenCalledWith({
                projectId: '6cfCcrrCFg2xP94Q',
                workspaceId: TEST_IDS.WORKSPACE_1,
            })
            expect(mockTodoistApi.moveProjectToPersonal).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Moved to workspace: My Project (id=6cfCcrrCFg2xP94Q)')
            expect(result.structuredContent).toEqual({
                project: expect.objectContaining({
                    id: '6cfCcrrCFg2xP94Q',
                    name: 'My Project',
                    workspaceId: TEST_IDS.WORKSPACE_1,
                }),
                success: true,
            })
        })

        it('should move a project to a workspace with folderId', async () => {
            const mockProject = createMockWorkspaceProject({
                id: '6cfCcrrCFg2xP94Q',
                name: 'My Project',
                workspaceId: TEST_IDS.WORKSPACE_1,
                folderId: 'folder-123',
            })
            mockTodoistApi.moveProjectToWorkspace.mockResolvedValue(mockProject)

            const result = await projectMove.execute(
                {
                    action: 'move-to-workspace',
                    projectId: '6cfCcrrCFg2xP94Q',
                    workspaceId: TEST_IDS.WORKSPACE_1,
                    folderId: 'folder-123',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveProjectToWorkspace).toHaveBeenCalledWith({
                projectId: '6cfCcrrCFg2xP94Q',
                workspaceId: TEST_IDS.WORKSPACE_1,
                folderId: 'folder-123',
            })
            expect(result.structuredContent?.success).toBe(true)
        })

        it('should move a project to a workspace with visibility', async () => {
            const mockProject = createMockWorkspaceProject({
                id: '6cfCcrrCFg2xP94Q',
                name: 'My Project',
                workspaceId: TEST_IDS.WORKSPACE_1,
            })
            mockTodoistApi.moveProjectToWorkspace.mockResolvedValue(mockProject)

            const result = await projectMove.execute(
                {
                    action: 'move-to-workspace',
                    projectId: '6cfCcrrCFg2xP94Q',
                    workspaceId: TEST_IDS.WORKSPACE_1,
                    visibility: 'team',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveProjectToWorkspace).toHaveBeenCalledWith({
                projectId: '6cfCcrrCFg2xP94Q',
                workspaceId: TEST_IDS.WORKSPACE_1,
                access: { visibility: 'team' },
            })
            expect(result.structuredContent?.success).toBe(true)
        })

        it('should move a project to a workspace with folderId and visibility', async () => {
            const mockProject = createMockWorkspaceProject({
                id: '6cfCcrrCFg2xP94Q',
                name: 'My Project',
                workspaceId: TEST_IDS.WORKSPACE_1,
                folderId: 'folder-456',
            })
            mockTodoistApi.moveProjectToWorkspace.mockResolvedValue(mockProject)

            const result = await projectMove.execute(
                {
                    action: 'move-to-workspace',
                    projectId: '6cfCcrrCFg2xP94Q',
                    workspaceId: TEST_IDS.WORKSPACE_1,
                    folderId: 'folder-456',
                    visibility: 'public',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveProjectToWorkspace).toHaveBeenCalledWith({
                projectId: '6cfCcrrCFg2xP94Q',
                workspaceId: TEST_IDS.WORKSPACE_1,
                folderId: 'folder-456',
                access: { visibility: 'public' },
            })
            expect(result.structuredContent?.success).toBe(true)
        })

        it('should throw error when workspaceId is missing', async () => {
            await expect(
                projectMove.execute(
                    {
                        action: 'move-to-workspace',
                        projectId: '6cfCcrrCFg2xP94Q',
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('workspaceId is required when action is move-to-workspace')

            expect(mockTodoistApi.moveProjectToWorkspace).not.toHaveBeenCalled()
        })
    })

    describe('move to personal', () => {
        it('should move a project to personal', async () => {
            const mockProject = createMockProject({
                id: '6cfCcrrCFg2xP94Q',
                name: 'My Project',
            })
            mockTodoistApi.moveProjectToPersonal.mockResolvedValue(mockProject)

            const result = await projectMove.execute(
                {
                    action: 'move-to-personal',
                    projectId: '6cfCcrrCFg2xP94Q',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.moveProjectToPersonal).toHaveBeenCalledWith({
                projectId: '6cfCcrrCFg2xP94Q',
            })
            expect(mockTodoistApi.moveProjectToWorkspace).not.toHaveBeenCalled()

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Moved to personal: My Project (id=6cfCcrrCFg2xP94Q)')
            expect(result.structuredContent).toEqual({
                project: expect.objectContaining({
                    id: '6cfCcrrCFg2xP94Q',
                    name: 'My Project',
                }),
                success: true,
            })
        })
    })

    describe('error handling', () => {
        it('should propagate errors from move to workspace', async () => {
            const apiError = new Error('API Error: Project not found')
            mockTodoistApi.moveProjectToWorkspace.mockRejectedValue(apiError)

            await expect(
                projectMove.execute(
                    {
                        action: 'move-to-workspace',
                        projectId: 'non-existent',
                        workspaceId: TEST_IDS.WORKSPACE_1,
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Project not found')
        })

        it('should propagate errors from move to personal', async () => {
            const apiError = new Error('API Error: Cannot move project')
            mockTodoistApi.moveProjectToPersonal.mockRejectedValue(apiError)

            await expect(
                projectMove.execute(
                    {
                        action: 'move-to-personal',
                        projectId: 'invalid-id',
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Cannot move project')
        })
    })
})
