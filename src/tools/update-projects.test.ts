import type { PersonalProject, TodoistApi, WorkspaceProject } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { ProjectSchema } from '../utils/output-schemas.js'
import { createMockProject } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { updateProjects } from './update-projects.js'

// Mock the Todoist API
const mockTodoistApi = {
    updateProject: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_PROJECTS } = ToolNames

describe(`${UPDATE_PROJECTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('updating a single project', () => {
        it('should update a project when id and name are provided', async () => {
            const mockApiResponse: PersonalProject = {
                url: 'https://todoist.com/projects/existing-project-123',
                id: 'existing-project-123',
                parentId: null,
                isDeleted: false,
                updatedAt: new Date('2025-08-13T22:10:30.000000Z'),
                childOrder: 1,
                description: '',
                isCollapsed: false,
                canAssignTasks: false,
                color: 'red',
                isFavorite: false,
                isFrozen: false,
                name: 'Updated Project Name',
                viewStyle: 'list',
                isArchived: false,
                inboxProject: false,
                isShared: false,
                createdAt: new Date('2024-01-01T00:00:00Z'),
                defaultOrder: 0,
            }

            mockTodoistApi.updateProject.mockResolvedValue(mockApiResponse)

            const result = await updateProjects.execute(
                { projects: [{ id: 'existing-project-123', name: 'Updated Project Name' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith('existing-project-123', {
                name: 'Updated Project Name',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Updated 1 project:')
            expect(textContent).toContain('Updated Project Name (id=existing-project-123)')

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    projects: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'existing-project-123',
                            name: 'Updated Project Name',
                        }),
                    ]),
                    totalCount: 1,
                    updatedProjectIds: ['existing-project-123'],
                    appliedOperations: {
                        updateCount: 1,
                        skippedCount: 0,
                    },
                }),
            )
        })

        it('should forward description to the API and map it back', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-123',
                name: 'Docs',
                description: 'Revised scope',
            })
            mockTodoistApi.updateProject.mockResolvedValue(mockApiResponse)

            const result = await updateProjects.execute(
                { projects: [{ id: 'project-123', description: 'Revised scope' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith(
                'project-123',
                expect.objectContaining({ description: 'Revised scope' }),
            )
            expect(result.structuredContent.projects[0]).toEqual(
                expect.objectContaining({ description: 'Revised scope' }),
            )
        })

        it('clears the description with an empty string', async () => {
            mockTodoistApi.updateProject.mockResolvedValue(
                createMockProject({ id: 'project-123', name: 'Docs', description: '' }),
            )

            await updateProjects.execute(
                { projects: [{ id: 'project-123', description: '' }] },
                mockTodoistApi,
            )

            // "" is the project wire clear value (backend NULL_KEEPS_UNCHANGED).
            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith('project-123', {
                description: '',
            })
        })

        it('treats legacy null as a clear (preprocessed to "")', async () => {
            mockTodoistApi.updateProject.mockResolvedValue(
                createMockProject({ id: 'project-123', name: 'Docs', description: '' }),
            )

            const parsed = z.object(updateProjects.parameters).parse({
                projects: [{ id: 'project-123', description: null }],
            })
            await updateProjects.execute(parsed, mockTodoistApi)

            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith('project-123', {
                description: '',
            })
        })

        it('saves the literal string "remove" as a description (no sentinel)', async () => {
            mockTodoistApi.updateProject.mockResolvedValue(
                createMockProject({ id: 'project-123', name: 'Docs', description: 'remove' }),
            )

            await updateProjects.execute(
                { projects: [{ id: 'project-123', description: 'remove' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith('project-123', {
                description: 'remove',
            })
        })

        it('should update project with isFavorite and viewStyle options', async () => {
            const mockApiResponse: PersonalProject = {
                url: 'https://todoist.com/projects/project-123',
                id: 'project-123',
                parentId: null,
                isDeleted: false,
                updatedAt: new Date('2025-08-13T22:10:30.000000Z'),
                childOrder: 1,
                description: '',
                isCollapsed: false,
                canAssignTasks: false,
                color: 'red',
                isFavorite: true,
                isFrozen: false,
                name: 'Updated Favorite Project',
                viewStyle: 'board',
                isArchived: false,
                inboxProject: false,
                isShared: false,
                createdAt: new Date('2024-01-01T00:00:00Z'),
                defaultOrder: 0,
            }

            mockTodoistApi.updateProject.mockResolvedValue(mockApiResponse)

            const result = await updateProjects.execute(
                {
                    projects: [
                        {
                            id: 'project-123',
                            name: 'Updated Favorite Project',
                            isFavorite: true,
                            viewStyle: 'board',
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith('project-123', {
                name: 'Updated Favorite Project',
                isFavorite: true,
                viewStyle: 'board',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Updated 1 project:')
            expect(textContent).toContain('Updated Favorite Project (id=project-123)')
        })
    })

    describe('color handling', () => {
        it('should pass a valid color key through to the API', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-color-1',
                name: 'Grape Project',
                color: 'grape',
            })
            mockTodoistApi.updateProject.mockResolvedValue(mockApiResponse)

            await updateProjects.execute(
                { projects: [{ id: 'project-color-1', color: 'grape' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith(
                'project-color-1',
                expect.objectContaining({ color: 'grape' }),
            )
        })

        it('should normalize a display name to the canonical color key', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-color-2',
                name: 'Grape Project',
                color: 'grape',
            })
            mockTodoistApi.updateProject.mockResolvedValue(mockApiResponse)

            // Parse through schema to trigger normalization, then call execute
            const parsed = z.object(updateProjects.parameters).parse({
                projects: [{ id: 'project-color-2', color: 'Grape' }],
            })
            await updateProjects.execute(parsed, mockTodoistApi)

            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith(
                'project-color-2',
                expect.objectContaining({ color: 'grape' }),
            )
        })

        it('should skip a project whose only field is an unrecognized color', async () => {
            // Parse through schema — unrecognized color normalizes to undefined
            // getSkipReason returns 'no-valid-values', so the project is skipped
            const parsed = z.object(updateProjects.parameters).parse({
                projects: [{ id: 'project-color-3', color: 'hotpink' }],
            })
            const result = await updateProjects.execute(parsed, mockTodoistApi)

            expect(mockTodoistApi.updateProject).not.toHaveBeenCalled()
            expect(result.textContent).toContain('skipped - no valid field values')
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 0,
                skippedCount: 1,
            })
        })

        it('should report no-valid-values and no-changes skips separately', async () => {
            const mockApiResponse = createMockProject({
                id: 'project-color-4',
                name: 'Named Project',
                color: 'grape',
            })
            mockTodoistApi.updateProject.mockResolvedValue(mockApiResponse)

            // project-A: unrecognized color only → 'no-valid-values'
            // project-B: no fields at all → 'no-fields'
            // project-C: valid update → actually updated
            const parsed = z.object(updateProjects.parameters).parse({
                projects: [
                    { id: 'project-A', color: 'hotpink' },
                    { id: 'project-B' },
                    { id: 'project-C', color: 'grape' },
                ],
            })
            const result = await updateProjects.execute(parsed, mockTodoistApi)

            expect(mockTodoistApi.updateProject).toHaveBeenCalledTimes(1)
            expect(result.textContent).toContain('1 skipped - no changes')
            expect(result.textContent).toContain('1 skipped - no valid field values')
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                skippedCount: 2,
            })
        })
    })

    describe('updating multiple projects', () => {
        it('should update multiple projects and return mapped results', async () => {
            type Project = PersonalProject | WorkspaceProject
            const mockProjects: [Project, Project, Project] = [
                createMockProject({ id: 'project-1', name: 'Updated First Project' }),
                createMockProject({ id: 'project-2', name: 'Updated Second Project' }),
                createMockProject({ id: 'project-3', name: 'Updated Third Project' }),
            ]

            const [project1, project2, project3] = mockProjects
            mockTodoistApi.updateProject
                .mockResolvedValueOnce(project1)
                .mockResolvedValueOnce(project2)
                .mockResolvedValueOnce(project3)

            const result = await updateProjects.execute(
                {
                    projects: [
                        { id: 'project-1', name: 'Updated First Project' },
                        { id: 'project-2', name: 'Updated Second Project' },
                        { id: 'project-3', name: 'Updated Third Project' },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly for each project
            expect(mockTodoistApi.updateProject).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.updateProject).toHaveBeenNthCalledWith(1, 'project-1', {
                name: 'Updated First Project',
            })
            expect(mockTodoistApi.updateProject).toHaveBeenNthCalledWith(2, 'project-2', {
                name: 'Updated Second Project',
            })
            expect(mockTodoistApi.updateProject).toHaveBeenNthCalledWith(3, 'project-3', {
                name: 'Updated Third Project',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Updated 3 projects:')
            expect(textContent).toContain('Updated First Project (id=project-1)')
            expect(textContent).toContain('Updated Second Project (id=project-2)')
            expect(textContent).toContain('Updated Third Project (id=project-3)')

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    projects: expect.arrayContaining([
                        expect.objectContaining({ id: 'project-1', name: 'Updated First Project' }),
                        expect.objectContaining({
                            id: 'project-2',
                            name: 'Updated Second Project',
                        }),
                        expect.objectContaining({ id: 'project-3', name: 'Updated Third Project' }),
                    ]),
                    totalCount: 3,
                    updatedProjectIds: ['project-1', 'project-2', 'project-3'],
                    appliedOperations: {
                        updateCount: 3,
                        skippedCount: 0,
                    },
                }),
            )
        })

        it('should skip projects with no updates and report correctly', async () => {
            const mockProject = createMockProject({
                id: 'project-1',
                name: 'Updated Project',
            })

            mockTodoistApi.updateProject.mockResolvedValue(mockProject)

            const result = await updateProjects.execute(
                {
                    projects: [
                        { id: 'project-1', name: 'Updated Project' },
                        { id: 'project-2' }, // No name provided, should be skipped
                    ],
                },
                mockTodoistApi,
            )

            // Should only call API once for the project with actual updates
            expect(mockTodoistApi.updateProject).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.updateProject).toHaveBeenCalledWith('project-1', {
                name: 'Updated Project',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Updated 1 project (1 skipped - no changes):\n')
            expect(textContent).toContain('Updated Project (id=project-1)')

            // Verify structured content reflects skipped count
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    appliedOperations: {
                        updateCount: 1,
                        skippedCount: 1,
                    },
                }),
            )
        })
    })

    describe('output schema validation', () => {
        it('should return structured content that strictly matches ProjectSchema (no extra API properties)', async () => {
            // Mock API response includes ALL properties from Todoist API
            const mockApiResponse: PersonalProject = {
                id: 'project-schema-test',
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
            }

            mockTodoistApi.updateProject.mockResolvedValue(mockApiResponse)

            const result = await updateProjects.execute(
                { projects: [{ id: 'project-schema-test', name: 'Schema Test Project' }] },
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
                'description',
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
            mockTodoistApi.updateProject
                .mockResolvedValueOnce(project1)
                .mockResolvedValueOnce(project2)

            const result = await updateProjects.execute(
                {
                    projects: [
                        { id: 'project-1', name: 'First' },
                        { id: 'project-2', name: 'Second' },
                    ],
                },
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

    describe('error handling', () => {
        it('should propagate API errors', async () => {
            const apiError = new Error('API Error: Project not found')
            mockTodoistApi.updateProject.mockRejectedValue(apiError)

            await expect(
                updateProjects.execute(
                    { projects: [{ id: 'nonexistent', name: 'New Name' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Project not found')
        })

        it('should handle partial failures in multiple projects', async () => {
            const mockProject = createMockProject({
                id: 'project-1',
                name: 'Updated Project',
            })

            mockTodoistApi.updateProject
                .mockResolvedValueOnce(mockProject)
                .mockRejectedValueOnce(new Error('API Error: Project not found'))

            await expect(
                updateProjects.execute(
                    {
                        projects: [
                            { id: 'project-1', name: 'Updated Project' },
                            { id: 'nonexistent', name: 'New Name' },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Project not found')
        })
    })
})
