import type { PersonalProject, TodoistApi, Workspace, WorkspaceProject } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { ProjectSchema } from '../../utils/output-schemas.js'
import {
    createMockProject,
    createMockWorkspaceProject,
    TEST_IDS,
} from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { workspaceResolver } from '../../utils/workspace-resolver.js'
import { addProjects } from '../add-projects.js'

// Mock the Todoist API
const mockTodoistApi = {
    addProject: vi.fn(),
    getWorkspaces: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_PROJECTS } = ToolNames

describe(`${ADD_PROJECTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('creating a single project', () => {
        it('should create a project and return mapped result', async () => {
            const mockApiResponse = createMockProject({
                id: TEST_IDS.PROJECT_TEST,
                name: 'test-abc123def456-project',
                childOrder: 1,
                createdAt: new Date('2024-01-01T00:00:00Z'),
            })

            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            const result = await addProjects.execute(
                { projects: [{ name: 'test-abc123def456-project' }] },
                mockTodoistApi,
            )

            // Verify API was called correctly
            expect(mockTodoistApi.addProject).toHaveBeenCalledWith({
                name: 'test-abc123def456-project',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 1 project:')
            expect(textContent).toContain('test-abc123def456-project')
            expect(textContent).toContain(`id=${TEST_IDS.PROJECT_TEST}`)

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    projects: [
                        expect.objectContaining({
                            id: TEST_IDS.PROJECT_TEST,
                            name: 'test-abc123def456-project',
                        }),
                    ],
                    totalCount: 1,
                }),
            )
        })

        it('should handle different project properties from API', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-456',
                name: 'My Blue Project',
                color: 'blue',
                isFavorite: true,
                isShared: true,
                parentId: 'parent-123',
                viewStyle: 'board',
                childOrder: 2,
                description: 'A test project',
                createdAt: new Date('2024-01-01T00:00:00Z'),
            })

            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            const result = await addProjects.execute(
                { projects: [{ name: 'My Blue Project' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addProject).toHaveBeenCalledWith({
                name: 'My Blue Project',
                isFavorite: undefined,
                viewStyle: undefined,
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 1 project:')
            expect(textContent).toContain('My Blue Project')
            expect(textContent).toContain('id=project-456')
        })

        it('should create project with isFavorite and viewStyle options', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-789',
                name: 'Board Project',
                isFavorite: true,
                viewStyle: 'board',
            })

            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            const result = await addProjects.execute(
                { projects: [{ name: 'Board Project', isFavorite: true, viewStyle: 'board' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addProject).toHaveBeenCalledWith({
                name: 'Board Project',
                isFavorite: true,
                viewStyle: 'board',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 1 project:')
            expect(textContent).toContain('Board Project')
            expect(textContent).toContain('id=project-789')
        })

        it('should create project with parentId to create a sub-project', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-child',
                name: 'Child Project',
                parentId: 'project-parent',
            })

            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            const result = await addProjects.execute(
                { projects: [{ name: 'Child Project', parentId: 'project-parent' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addProject).toHaveBeenCalledWith({
                name: 'Child Project',
                parentId: 'project-parent',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 1 project:')
            expect(textContent).toContain('Child Project')
            expect(textContent).toContain('id=project-child')
        })
    })

    describe('color handling', () => {
        it('should pass a valid color key through to the API', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-color-1',
                name: 'Berry Project',
                color: 'berry_red',
            })
            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            await addProjects.execute(
                { projects: [{ name: 'Berry Project', color: 'berry_red' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addProject).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Berry Project', color: 'berry_red' }),
            )
        })

        it('should normalize a display name to the canonical color key', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-color-2',
                name: 'Berry Project',
                color: 'berry_red',
            })
            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            // Parse through schema to trigger normalization, then call execute
            const parsed = z.object(addProjects.parameters).parse({
                projects: [{ name: 'Berry Project', color: 'Berry Red' }],
            })
            await addProjects.execute(parsed, mockTodoistApi)

            expect(mockTodoistApi.addProject).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Berry Project', color: 'berry_red' }),
            )
        })

        it('should omit an unrecognized color and not pass it to the API', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-color-3',
                name: 'Colorless Project',
            })
            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            // Parse through schema — unrecognized color normalizes to undefined
            const parsed = z.object(addProjects.parameters).parse({
                projects: [{ name: 'Colorless Project', color: 'hotpink' }],
            })
            await addProjects.execute(parsed, mockTodoistApi)

            const call = mockTodoistApi.addProject.mock.calls[0]?.[0]
            expect(call).toBeDefined()
            expect(call?.color).toBeUndefined()
        })
    })

    describe('creating multiple projects', () => {
        it('should create multiple projects and return mapped results', async () => {
            type Project = PersonalProject | WorkspaceProject
            const mockProjects: [Project, Project, Project] = [
                createMockProject({ id: 'project-1', name: 'First Project' }),
                createMockProject({ id: 'project-2', name: 'Second Project' }),
                createMockProject({ id: 'project-3', name: 'Third Project' }),
            ]

            const [project1, project2, project3] = mockProjects
            mockTodoistApi.addProject
                .mockResolvedValueOnce(project1)
                .mockResolvedValueOnce(project2)
                .mockResolvedValueOnce(project3)

            const result = await addProjects.execute(
                {
                    projects: [
                        { name: 'First Project' },
                        { name: 'Second Project' },
                        { name: 'Third Project' },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly for each project
            expect(mockTodoistApi.addProject).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.addProject).toHaveBeenNthCalledWith(1, { name: 'First Project' })
            expect(mockTodoistApi.addProject).toHaveBeenNthCalledWith(2, { name: 'Second Project' })
            expect(mockTodoistApi.addProject).toHaveBeenNthCalledWith(3, { name: 'Third Project' })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 3 projects:')
            expect(textContent).toContain('First Project (id=project-1)')
            expect(textContent).toContain('Second Project (id=project-2)')
            expect(textContent).toContain('Third Project (id=project-3)')

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    projects: expect.arrayContaining([
                        expect.objectContaining({ id: 'project-1', name: 'First Project' }),
                        expect.objectContaining({ id: 'project-2', name: 'Second Project' }),
                        expect.objectContaining({ id: 'project-3', name: 'Third Project' }),
                    ]),
                    totalCount: 3,
                }),
            )
        })
    })

    describe('output schema validation', () => {
        it('should return structured content that strictly matches ProjectSchema (no extra API properties)', async () => {
            // Mock API response includes ALL properties from Todoist API
            // This simulates the real API response which has many extra fields
            const mockApiResponse = createMockProject({
                id: TEST_IDS.PROJECT_TEST,
                name: 'Schema Test Project',
                color: 'blue',
                isFavorite: true,
                isShared: false,
                parentId: 'parent-123',
                inboxProject: false,
                viewStyle: 'board',
                // Extra properties that should NOT appear in structured output:
                childOrder: 5,
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-06-15T12:00:00Z'),
                defaultOrder: 10,
                description: 'This should not appear in output',
                isArchived: false,
                isCollapsed: true,
                isDeleted: false,
                isFrozen: false,
                canAssignTasks: true,
                url: 'https://todoist.com/projects/test',
            })

            mockTodoistApi.addProject.mockResolvedValue(mockApiResponse)

            const result = await addProjects.execute(
                { projects: [{ name: 'Schema Test Project' }] },
                mockTodoistApi,
            )

            const structuredContent = result.structuredContent
            expect(structuredContent.projects).toHaveLength(1)

            const project = structuredContent.projects.at(0)
            expect(project).toBeDefined()
            if (!project) return // Type narrowing

            // Verify ONLY the schema-allowed properties are present
            const allowedKeys = [
                'id',
                'name',
                'color',
                'isFavorite',
                'isShared',
                'parentId',
                'inboxProject',
                'viewStyle',
                'workspaceId',
                'folderId',
                'childOrder',
            ]
            const actualKeys = Object.keys(project)
            expect(actualKeys.sort()).toEqual(allowedKeys.sort())

            // Verify NO extra API properties leaked through
            const disallowedKeys = [
                'createdAt',
                'updatedAt',
                'defaultOrder',
                'description',
                'isArchived',
                'isCollapsed',
                'isDeleted',
                'isFrozen',
                'canAssignTasks',
                'url',
            ]
            for (const key of disallowedKeys) {
                expect(project).not.toHaveProperty(key)
            }

            // Validate against the actual Zod schema (strict mode rejects extra properties)
            const parseResult = ProjectSchema.strict().safeParse(project)
            expect(parseResult.success).toBe(true)
        })

        it('should produce output that passes strict schema validation for multiple projects', async () => {
            type Project = PersonalProject | WorkspaceProject
            const mockProjects: [Project, Project] = [
                createMockProject({
                    id: 'project-1',
                    name: 'First',
                    childOrder: 1,
                    url: 'https://todoist.com/1',
                }),
                createMockProject({
                    id: 'project-2',
                    name: 'Second',
                    childOrder: 2,
                    url: 'https://todoist.com/2',
                }),
            ]

            const [project1, project2] = mockProjects
            mockTodoistApi.addProject
                .mockResolvedValueOnce(project1)
                .mockResolvedValueOnce(project2)

            const result = await addProjects.execute(
                { projects: [{ name: 'First' }, { name: 'Second' }] },
                mockTodoistApi,
            )

            // Validate each project in structured content against strict schema
            for (const project of result.structuredContent.projects) {
                const parseResult = ProjectSchema.strict().safeParse(project)
                expect(parseResult.success).toBe(true)
                if (!parseResult.success) {
                    console.error('Schema validation failed:', parseResult.error.format())
                }
            }
        })
    })

    describe('workspace support', () => {
        beforeEach(() => {
            workspaceResolver.clearCache()
        })

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

        it('should pass workspaceId when workspace is specified by ID', async () => {
            const mockWorkspaces = [createMockWorkspace({ id: '111', name: 'Engineering' })]
            mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

            const mockProject = createMockWorkspaceProject({
                id: 'ws-project-1',
                name: 'WS Project',
                workspaceId: '111',
            })
            mockTodoistApi.addProject.mockResolvedValue(mockProject)

            await addProjects.execute(
                { projects: [{ name: 'WS Project', workspace: '111' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addProject).toHaveBeenCalledWith({
                name: 'WS Project',
                workspaceId: '111',
            })
        })

        it('should resolve workspace by name and pass workspaceId', async () => {
            const mockWorkspaces = [createMockWorkspace({ id: '222', name: 'Marketing Team' })]
            mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

            const mockProject = createMockWorkspaceProject({
                id: 'ws-project-2',
                name: 'Marketing Project',
                workspaceId: '222',
            })
            mockTodoistApi.addProject.mockResolvedValue(mockProject)

            await addProjects.execute(
                { projects: [{ name: 'Marketing Project', workspace: 'Marketing Team' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addProject).toHaveBeenCalledWith({
                name: 'Marketing Project',
                workspaceId: '222',
            })
        })

        it('should handle mixed projects with and without workspace', async () => {
            const mockWorkspaces = [createMockWorkspace({ id: '333', name: 'Engineering' })]
            mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

            const personalProject = createMockProject({ id: 'p-1', name: 'Personal' })
            const wsProject = createMockWorkspaceProject({
                id: 'ws-1',
                name: 'Work',
                workspaceId: '333',
            })

            mockTodoistApi.addProject
                .mockResolvedValueOnce(personalProject)
                .mockResolvedValueOnce(wsProject)

            await addProjects.execute(
                {
                    projects: [{ name: 'Personal' }, { name: 'Work', workspace: 'Engineering' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addProject).toHaveBeenNthCalledWith(1, { name: 'Personal' })
            expect(mockTodoistApi.addProject).toHaveBeenNthCalledWith(2, {
                name: 'Work',
                workspaceId: '333',
            })
        })

        it('should resolve the same workspace name only once for multiple projects', async () => {
            const mockWorkspaces = [createMockWorkspace({ id: '444', name: 'Engineering' })]
            mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

            const project1 = createMockWorkspaceProject({
                id: 'ws-1',
                name: 'Project A',
                workspaceId: '444',
            })
            const project2 = createMockWorkspaceProject({
                id: 'ws-2',
                name: 'Project B',
                workspaceId: '444',
            })
            mockTodoistApi.addProject
                .mockResolvedValueOnce(project1)
                .mockResolvedValueOnce(project2)

            await addProjects.execute(
                {
                    projects: [
                        { name: 'Project A', workspace: 'Engineering' },
                        { name: 'Project B', workspace: 'Engineering' },
                    ],
                },
                mockTodoistApi,
            )

            // getWorkspaces should only be called once (cached)
            expect(mockTodoistApi.getWorkspaces).toHaveBeenCalledTimes(1)
        })

        it('should throw when workspace name is ambiguous', async () => {
            const mockWorkspaces = [
                createMockWorkspace({ id: '555', name: 'Engineering Team' }),
                createMockWorkspace({ id: '666', name: 'Marketing Team' }),
            ]
            mockTodoistApi.getWorkspaces.mockResolvedValue(mockWorkspaces)

            await expect(
                addProjects.execute(
                    { projects: [{ name: 'Project', workspace: 'Team' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(/Ambiguous workspace reference/)
        })

        it('should throw when workspace name is not found', async () => {
            mockTodoistApi.getWorkspaces.mockResolvedValue([
                createMockWorkspace({ id: '777', name: 'Engineering' }),
            ])

            await expect(
                addProjects.execute(
                    { projects: [{ name: 'Project', workspace: 'Nonexistent' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(/Workspace "Nonexistent" not found/)
        })
    })

    describe('error handling', () => {
        it('should propagate API errors', async () => {
            const apiError = new Error('API Error: Project name is required')
            mockTodoistApi.addProject.mockRejectedValue(apiError)

            await expect(
                addProjects.execute({ projects: [{ name: '' }] }, mockTodoistApi),
            ).rejects.toThrow('API Error: Project name is required')
        })

        it('retries a transient 5xx failure on a per-item call via the retry helper', async () => {
            // A per-item transient error must still get backoff+retry (it used to bubble
            // up to the registerTool wrapper before the batch was settled per item). The
            // first attempt fails with 503, the retry succeeds, so the item is reported as
            // a success rather than a permanent failure.
            vi.useFakeTimers()
            try {
                const okProject = createMockProject({ id: 'p-retry', name: 'Eventually OK' })
                mockTodoistApi.addProject
                    .mockRejectedValueOnce(
                        Object.assign(new Error('Service Unavailable'), { httpStatusCode: 503 }),
                    )
                    .mockResolvedValueOnce(okProject)

                const promise = addProjects.execute(
                    { projects: [{ name: 'Eventually OK' }] },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.addProject).toHaveBeenCalledTimes(2)
                expect(result.structuredContent.projects).toHaveLength(1)
                expect(result.structuredContent.failureCount).toBe(0)
            } finally {
                vi.useRealTimers()
            }
        })

        it('should keep successful projects when one in the batch fails', async () => {
            const mockProject = createMockProject({
                id: 'project-1',
                name: 'First Project',
            })

            mockTodoistApi.addProject
                .mockResolvedValueOnce(mockProject)
                .mockRejectedValueOnce(new Error('API Error: Invalid project name'))

            const result = await addProjects.execute(
                {
                    projects: [{ name: 'First Project' }, { name: 'Invalid' }],
                },
                mockTodoistApi,
            )

            // The successful project is preserved instead of being discarded by the failure.
            const { structuredContent } = result
            expect(structuredContent.projects).toHaveLength(1)
            expect(structuredContent.totalCount).toBe(1)
            expect(structuredContent.successCount).toBe(1)
            expect(structuredContent.totalRequested).toBe(2)

            // The failure is reported per-item with the offending project identified by name.
            expect(structuredContent.failureCount).toBe(1)
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('Invalid')
            expect(structuredContent.failures[0]?.error).toContain(
                'API Error: Invalid project name',
            )

            expect(result.textContent).toContain('Added 1 project:')
            expect(result.textContent).toContain('Failed (1)')
            expect(result.textContent).toContain('not retried automatically')
        })

        it('should throw when every project in the batch fails', async () => {
            mockTodoistApi.addProject
                .mockRejectedValueOnce(new Error('API Error: Invalid project name'))
                .mockRejectedValueOnce(new Error('API Error: Invalid project name'))

            await expect(
                addProjects.execute(
                    {
                        projects: [{ name: 'Invalid 1' }, { name: 'Invalid 2' }],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('All 2 project(s) failed to create')
        })
    })
})
