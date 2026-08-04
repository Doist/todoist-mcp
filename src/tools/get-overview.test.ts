import type { PersonalProject, Section, Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { removeNullFields } from '../utils/sanitize-data.js'
import {
    createMockProject,
    createMockSection,
    createMockTask,
    createMockWorkspaceProject,
    TEST_ERRORS,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { getOverview } from './get-overview.js'

// Mock the Todoist API
const mockTodoistApi = {
    getProjects: vi.fn(),
    getProject: vi.fn(),
    getSections: vi.fn(),
    getTasks: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { GET_OVERVIEW } = ToolNames

describe(`${GET_OVERVIEW} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('account overview (no projectId)', () => {
        it('should generate account overview with projects and sections', async () => {
            const mockProjects: PersonalProject[] = [
                createMockProject({
                    id: TEST_IDS.PROJECT_INBOX,
                    name: 'Inbox',
                    color: 'grey',
                    inboxProject: true,
                    childOrder: 0,
                }),
                createMockProject({
                    id: TEST_IDS.PROJECT_TEST,
                    name: 'test-abc123def456-project',
                    childOrder: 1,
                }),
            ]

            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_1,
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'test-section',
                }),
            ]

            mockTodoistApi.getProjects.mockResolvedValue({
                results: mockProjects,
                nextCursor: null,
            })
            mockTodoistApi.getSections.mockImplementation((args) => {
                const { projectId } = args as { projectId: string }
                if (projectId === TEST_IDS.PROJECT_TEST) {
                    return Promise.resolve({ results: mockSections, nextCursor: null })
                }
                return Promise.resolve({ results: [], nextCursor: null })
            })

            const result = await getOverview.execute({}, mockTodoistApi)

            expect(mockTodoistApi.getProjects).toHaveBeenCalledWith({})
            expect(mockTodoistApi.getSections).toHaveBeenCalledTimes(2) // Once for each project

            // Test text content with snapshot
            expect(result.textContent).toMatchSnapshot()

            // Test structured content sanity checks
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    type: 'account_overview',
                    inbox: expect.objectContaining({
                        id: TEST_IDS.PROJECT_INBOX,
                        name: 'Inbox',
                        // sections array removed if empty
                    }),
                    projects: expect.any(Array),
                    totalProjects: 2,
                    totalSections: 1,
                    hasNestedProjects: false,
                }),
            )
            expect(structuredContent.projects).toHaveLength(1) // Only non-inbox projects
        })

        it('should produce structured content that survives removeNullFields sanitization', async () => {
            const mockProjects = [
                createMockProject({
                    id: TEST_IDS.PROJECT_INBOX,
                    name: 'Inbox',
                    inboxProject: true,
                    parentId: null,
                    childOrder: 0,
                }),
                createMockProject({
                    id: TEST_IDS.PROJECT_TEST,
                    name: 'Top-level project',
                    parentId: null,
                    childOrder: 1,
                }),
                createMockWorkspaceProject({
                    id: TEST_IDS.PROJECT_WORKSPACE,
                    name: 'Workspace project',
                    folderId: null,
                    childOrder: 2,
                }),
            ]

            mockTodoistApi.getProjects.mockResolvedValue({
                results: mockProjects,
                nextCursor: null,
            })
            mockTodoistApi.getSections.mockResolvedValue({
                results: [],
                nextCursor: null,
            })

            const result = await getOverview.execute({}, mockTodoistApi)
            const sanitized = removeNullFields(result.structuredContent)

            // After sanitization, projects should still have valid structure
            // This verifies the fix for #379 where removeNullFields stripped
            // nullable parentId/folderId, causing schema validation failures
            expect(sanitized.projects).toHaveLength(2) // Non-inbox projects
            for (const project of sanitized.projects as Array<Record<string, unknown>>) {
                expect(project).toHaveProperty('id')
                expect(project).toHaveProperty('name')
                expect(project).toHaveProperty('childOrder')
                // parentId and folderId must never be null — removeNullFields
                // would strip them, breaking the output schema validation
                expect(project.parentId).toBeUndefined()
                expect(project.folderId).toBeUndefined()
            }
        })

        it('should handle empty projects list', async () => {
            mockTodoistApi.getProjects.mockResolvedValue({ results: [], nextCursor: null })

            const result = await getOverview.execute({}, mockTodoistApi)

            // Test text content with snapshot
            expect(result.textContent).toMatchSnapshot()

            // Test structured content sanity checks
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual({
                type: 'account_overview',
                projects: [], // projects array is now kept as empty array
                totalProjects: 0,
                totalSections: 0,
                hasNestedProjects: false,
                inbox: null,
            })
        })
    })

    describe('project overview (with projectId)', () => {
        it('should generate detailed project overview with tasks', async () => {
            const mockProject = createMockProject({
                id: TEST_IDS.PROJECT_TEST,
                name: 'test-abc123def456-project',
            })

            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_1,
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'To Do',
                }),
                createMockSection({
                    id: TEST_IDS.SECTION_2,
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 2,
                    name: 'In Progress',
                }),
            ]

            const mockTasks: Task[] = [
                createMockTask({
                    id: TEST_IDS.TASK_1,
                    content: 'Task without section',
                    projectId: TEST_IDS.PROJECT_TEST,
                    deadline: {
                        date: '2025-08-15',
                        lang: 'en',
                    },
                    responsibleUid: TEST_IDS.USER_ID,
                    assignedByUid: TEST_IDS.USER_ID,
                }),
                createMockTask({
                    id: TEST_IDS.TASK_2,
                    content: 'Task in To Do section',
                    description: 'Important task',
                    labels: ['work'],
                    priority: 'p3',
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionId: TEST_IDS.SECTION_1,
                }),
                createMockTask({
                    id: TEST_IDS.TASK_3,
                    content: 'Subtask of important task',
                    childOrder: 2,
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionId: TEST_IDS.SECTION_1,
                    parentId: TEST_IDS.TASK_2,
                }),
            ]

            mockTodoistApi.getProject.mockResolvedValue(mockProject)
            mockTodoistApi.getSections.mockResolvedValue({
                results: mockSections,
                nextCursor: null,
            })
            mockTodoistApi.getTasks.mockResolvedValue({
                results: mockTasks,
                nextCursor: null,
            })

            const result = await getOverview.execute(
                { projectId: TEST_IDS.PROJECT_TEST },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProject).toHaveBeenCalledWith(TEST_IDS.PROJECT_TEST)
            expect(mockTodoistApi.getSections).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
            })
            expect(mockTodoistApi.getTasks).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
                limit: 50,
                cursor: undefined,
            })

            // Test text content with snapshot
            expect(result.textContent).toMatchSnapshot()

            // Test structured content sanity checks
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    type: 'project_overview',
                    project: expect.objectContaining({
                        id: TEST_IDS.PROJECT_TEST,
                        name: 'test-abc123def456-project',
                    }),
                    sections: expect.any(Array),
                    tasks: expect.any(Array),
                    stats: expect.objectContaining({
                        totalTasks: 3,
                        totalSections: 2,
                        tasksWithoutSection: 1,
                    }),
                }),
            )
            expect(structuredContent.sections).toHaveLength(2)
            expect(structuredContent.tasks).toHaveLength(3)
        })

        it('should handle project with no tasks', async () => {
            const mockProject = createMockProject({
                id: 'empty-project-id',
                name: 'Empty Project',
                color: 'blue',
            })

            mockTodoistApi.getProject.mockResolvedValue(mockProject)
            mockTodoistApi.getSections.mockResolvedValue({ results: [], nextCursor: null })
            mockTodoistApi.getTasks.mockResolvedValue({ results: [], nextCursor: null })

            const result = await getOverview.execute(
                { projectId: 'empty-project-id' },
                mockTodoistApi,
            )

            // Test text content with snapshot
            expect(result.textContent).toMatchSnapshot()

            // Test structured content sanity checks
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual({
                type: 'project_overview',
                project: expect.objectContaining({
                    id: 'empty-project-id',
                    name: 'Empty Project',
                }),
                sections: [], // sections array is now kept as empty array
                tasks: [], // tasks array is now kept as empty array
                stats: expect.objectContaining({
                    totalTasks: 0,
                    totalSections: 0,
                    tasksWithoutSection: 0,
                }),
            })
        })
    })

    describe('error handling', () => {
        it.each([
            {
                scenario: 'project retrieval',
                error: 'API Error: Project not found',
                params: { projectId: 'non-existent-project' },
                mockMethod: 'getProject' as const,
            },
            {
                scenario: 'projects list',
                error: TEST_ERRORS.API_UNAUTHORIZED,
                params: {},
                mockMethod: 'getProjects' as const,
            },
        ])('should propagate API errors for $scenario', async ({ error, params, mockMethod }) => {
            const apiError = new Error(error)
            mockTodoistApi[mockMethod].mockRejectedValue(apiError)

            await expect(getOverview.execute(params, mockTodoistApi)).rejects.toThrow(error)
        })
    })
})
