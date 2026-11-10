import type { Template, TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import {
    createApiError,
    createMockProject,
    createMockWorkspace,
    createMockWorkspaceProject,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'
import { createTemplate } from './create-template.js'

const mockTodoistApi = {
    saveProjectAsTemplate: vi.fn(),
    previewProjectAsTemplate: vi.fn(),
    previewTemplateFromCSV: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    getProject: vi.fn(),
    getWorkspaces: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { CREATE_TEMPLATE } = ToolNames

function buildTemplate(overrides: Partial<Template> = {}): Template {
    return {
        id: 'UT_28Ex1',
        name: 'Launch plan',
        templateType: 'project',
        templateSource: 'user',
        shortDescription: 'Everything for a launch',
        longDescription: 'Everything for a launch',
        instructions: null,
        thumbnailImage: null,
        thumbnailImageDark: null,
        coverImage: null,
        previewImage: null,
        templateColor: 'blue',
        backgroundColor: null,
        backgroundColorDark: null,
        creator: { userId: '1', name: 'Ada', position: '', avatar: '' },
        seo: null,
        moreResources: [],
        categoryIds: [],
        workspaceId: null,
        sharedWithWorkspaceMembers: false,
        ...overrides,
    }
}

const EDITED = {
    projects: [{ viewStyle: 'list' as const }],
    sections: [],
    tasks: [{ id: 't1', content: 'Plan', priority: 'p1' as const }],
    comments: [],
    projectComments: [],
    projectViewOptionsDefaults: [],
}

const SAVE = { preview: false, name: 'Launch plan', description: 'A launch' }

describe(`${CREATE_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        workspaceResolver.clearCache()
        mockTodoistApi.saveProjectAsTemplate.mockResolvedValue(buildTemplate())
        mockTodoistApi.createTemplate.mockResolvedValue(buildTemplate())
        mockTodoistApi.getProject.mockResolvedValue(
            createMockProject({ id: 'project-1', color: 'berry_red' }),
        )
        mockTodoistApi.getWorkspaces.mockResolvedValue([createMockWorkspace()])
    })

    describe('draft', () => {
        it('returns a blank draft without a project, a CSV or any request', async () => {
            const result = await createTemplate.execute({}, mockTodoistApi)

            expect(mockTodoistApi.previewProjectAsTemplate).not.toHaveBeenCalled()
            expect(mockTodoistApi.previewTemplateFromCSV).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual({
                content: {
                    projects: [{ viewStyle: 'list' }],
                    sections: [],
                    tasks: [],
                    comments: [],
                    projectComments: [],
                    projectViewOptionsDefaults: [],
                },
            })
            expect(result.textContent).toBe(
                'Blank template draft, not saved: list layout, 0 sections, 0 tasks.\nAdd sections and tasks to its `content`. Before saving, show the user the draft and ask whether to change anything. Then call create-template again with preview: false, a name and description, and the `content`.',
            )
        })

        it("returns a project's draft without saving anything", async () => {
            mockTodoistApi.previewProjectAsTemplate.mockResolvedValue({
                templateType: 'project',
                workspaceId: null,
                content: {
                    projects: [{ viewStyle: 'board', description: null, icon: null }],
                    sections: [{ id: 's1', name: 'Week 1', description: null }],
                    tasks: [
                        { id: 't1', content: 'Plan', sectionId: 's1', priority: 4 },
                        { id: 't2', content: 'Details', parentId: 't1', priority: 1 },
                    ],
                    comments: [],
                    projectComments: [],
                    projectViewOptionsDefaults: [],
                },
            })

            const result = await createTemplate.execute(
                { projectId: 'project-1', name: 'Launch plan', description: 'A launch' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.previewProjectAsTemplate).toHaveBeenCalledWith('project-1')
            expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual({
                content: {
                    projects: [{ viewStyle: 'board' }],
                    sections: [{ id: 's1', name: 'Week 1' }],
                    tasks: [
                        { id: 't1', content: 'Plan', sectionId: 's1', priority: 'p1' },
                        { id: 't2', content: 'Details', parentId: 't1', priority: 'p4' },
                    ],
                    comments: [],
                    projectComments: [],
                    projectViewOptionsDefaults: [],
                },
            })
            expect(result.textContent).toBe(
                'Draft of project (id=project-1) as a template, not saved: board layout, 1 section, 2 tasks.\n- Plan [Week 1]\n    - Details\nBefore saving, show the user the draft and ask whether to change anything. Then call create-template again with preview: false, a name and description, and the edited `content` if it changed.',
            )
        })

        it("returns a CSV's draft without creating a template", async () => {
            mockTodoistApi.previewTemplateFromCSV.mockResolvedValue({
                templateType: 'project',
                workspaceId: null,
                uploadedFileName: 'staged.csv',
                content: {
                    projects: [{ viewStyle: 'list', description: null, icon: null }],
                    sections: [],
                    tasks: [{ id: 't1', content: 'Plan', priority: 1 }],
                    comments: [],
                    projectComments: [],
                    projectViewOptionsDefaults: [],
                },
            })

            const result = await createTemplate.execute(
                { csvFileContent: 'TYPE,CONTENT\ntask,Plan' },
                mockTodoistApi,
            )

            const file = mockTodoistApi.previewTemplateFromCSV.mock.calls[0]?.[0].file
            expect(file).toBeInstanceOf(Blob)
            expect(await (file as Blob).text()).toBe('TYPE,CONTENT\ntask,Plan')
            expect(mockTodoistApi.createTemplate).not.toHaveBeenCalled()
            expect(result.textContent).toContain(
                'Draft of the CSV as a template, not saved: list layout, 0 sections, 1 task.',
            )
        })

        it('outlines given content without saving it', async () => {
            const result = await createTemplate.execute({ content: EDITED }, mockTodoistApi)

            expect(mockTodoistApi.createTemplate).not.toHaveBeenCalled()
            expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual({ content: EDITED })
            expect(result.textContent).toContain(
                'Template draft, not saved: list layout, 0 sections, 1 task.\n- Plan',
            )
        })
    })

    describe('saving from a project', () => {
        it("saves a personal template in the project's color", async () => {
            const result = await createTemplate.execute(
                { projectId: 'project-1', ...SAVE },
                mockTodoistApi,
            )

            expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith({
                projectId: 'project-1',
                name: 'Launch plan',
                description: 'A launch',
                color: 'berry_red',
                forWorkspace: undefined,
                content: undefined,
            })
            expect(mockTodoistApi.updateTemplate).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual({
                templateId: 'UT_28Ex1',
                name: 'Launch plan',
            })
            expect(result.textContent).toBe(
                'Created template "Launch plan" (id=UT_28Ex1) from project (id=project-1). It is in your personal templates. Use create-project-from-template with this ID to start a new project from it.',
            )
        })

        it('uses the given color without reading the project', async () => {
            await createTemplate.execute(
                { projectId: 'project-1', ...SAVE, color: 'blue' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
            expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith(
                expect.objectContaining({ color: 'blue' }),
            )
        })

        it('falls back to charcoal when the project color is not one it recognizes', async () => {
            mockTodoistApi.getProject.mockResolvedValue(
                createMockProject({ id: 'project-1', color: 'not-a-color' }),
            )

            await createTemplate.execute({ projectId: 'project-1', ...SAVE }, mockTodoistApi)

            expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith(
                expect.objectContaining({ color: 'charcoal' }),
            )
        })

        it('saves an edited draft instead of the project as it is', async () => {
            await createTemplate.execute(
                { projectId: 'project-1', ...SAVE, color: 'blue', content: EDITED },
                mockTodoistApi,
            )

            expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith(
                expect.objectContaining({
                    projectId: 'project-1',
                    content: expect.objectContaining({
                        projects: [{ viewStyle: 'list' }],
                        tasks: [{ id: 't1', content: 'Plan', priority: 4 }],
                    }),
                }),
            )
        })

        it("saves straight into the project's own workspace, keeping assignees", async () => {
            mockTodoistApi.getProject.mockResolvedValue(createMockWorkspaceProject())
            mockTodoistApi.saveProjectAsTemplate.mockResolvedValue(
                buildTemplate({ workspaceId: TEST_IDS.WORKSPACE_1 }),
            )

            const result = await createTemplate.execute(
                { projectId: TEST_IDS.PROJECT_WORKSPACE, ...SAVE, workspace: 'Test Workspace' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith(
                expect.objectContaining({ forWorkspace: true }),
            )
            expect(mockTodoistApi.updateTemplate).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual(
                expect.objectContaining({ workspaceId: TEST_IDS.WORKSPACE_1 }),
            )
            expect(result.textContent).toContain(
                `It is in the workspace's templates (workspace id=${TEST_IDS.WORKSPACE_1}), not yet shared with members.`,
            )
        })

        it('saves nothing when the project cannot be read for its color', async () => {
            mockTodoistApi.getProject.mockRejectedValue(new Error('Project not found'))

            await expect(
                createTemplate.execute({ projectId: 'missing', ...SAVE }, mockTodoistApi),
            ).rejects.toThrow('Project not found')
            expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
        })

        it('retries the save after a 503', async () => {
            vi.useFakeTimers()
            try {
                mockTodoistApi.saveProjectAsTemplate
                    .mockRejectedValueOnce(
                        createApiError({ status: 503, error: 'Service Unavailable' }),
                    )
                    .mockResolvedValueOnce(buildTemplate())

                const promise = createTemplate.execute(
                    { projectId: 'project-1', ...SAVE, color: 'blue' },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                await promise

                expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledTimes(2)
            } finally {
                vi.useRealTimers()
            }
        })

        it('does not retry the save after a 502, since the template may already exist', async () => {
            mockTodoistApi.saveProjectAsTemplate.mockRejectedValue(
                createApiError({ status: 502, error: 'Bad gateway' }),
            )

            await expect(
                createTemplate.execute(
                    { projectId: 'project-1', ...SAVE, color: 'blue' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow()
            expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledTimes(1)
        })
    })

    describe('saving without a project', () => {
        it('saves content written from scratch as a personal template, in charcoal', async () => {
            const result = await createTemplate.execute(
                { ...SAVE, content: EDITED },
                mockTodoistApi,
            )

            const [args] = mockTodoistApi.createTemplate.mock.calls[0] ?? []
            expect(args).not.toHaveProperty('file')
            expect(args).toEqual(
                expect.objectContaining({
                    name: 'Launch plan',
                    description: 'A launch',
                    color: 'charcoal',
                    content: expect.objectContaining({
                        tasks: [{ id: 't1', content: 'Plan', priority: 4 }],
                    }),
                }),
            )
            expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
            expect(result.textContent).toContain(
                'Created template "Launch plan" (id=UT_28Ex1) from the draft. It is in your personal templates.',
            )
        })

        it('uploads the CSV as a file', async () => {
            const result = await createTemplate.execute(
                { ...SAVE, csvFileContent: 'TYPE,CONTENT\ntask,Plan', color: 'blue' },
                mockTodoistApi,
            )

            const [args] = mockTodoistApi.createTemplate.mock.calls[0] ?? []
            expect(args?.fileName).toBe('template.csv')
            expect(await (args?.file as Blob).text()).toBe('TYPE,CONTENT\ntask,Plan')
            expect(args?.color).toBe('blue')
            expect(result.textContent).toContain('from CSV content')
        })

        it('moves the new template into a workspace and shares it, as the app does', async () => {
            mockTodoistApi.updateTemplate.mockResolvedValue(
                buildTemplate({
                    workspaceId: TEST_IDS.WORKSPACE_1,
                    sharedWithWorkspaceMembers: true,
                }),
            )

            const result = await createTemplate.execute(
                {
                    ...SAVE,
                    content: EDITED,
                    workspace: 'Test Workspace',
                    sharedWithWorkspaceMembers: true,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateTemplate).toHaveBeenCalledWith('UT_28Ex1', {
                workspaceId: TEST_IDS.WORKSPACE_1,
                sharedWithWorkspaceMembers: true,
            })
            expect(result.structuredContent).toEqual({
                templateId: 'UT_28Ex1',
                name: 'Launch plan',
                workspaceId: TEST_IDS.WORKSPACE_1,
            })
            expect(result.textContent).toContain(
                `It is in the workspace's templates (workspace id=${TEST_IDS.WORKSPACE_1}), shared with members.`,
            )
        })

        it('reports a template it created but could not move, instead of failing', async () => {
            mockTodoistApi.updateTemplate.mockRejectedValue(new Error('Forbidden'))

            const result = await createTemplate.execute(
                { ...SAVE, content: EDITED, workspace: 'Test Workspace' },
                mockTodoistApi,
            )

            expect(result.structuredContent).toEqual({
                templateId: 'UT_28Ex1',
                name: 'Launch plan',
                workspaceError: 'Forbidden',
            })
            expect(result.textContent).toBe(
                'Created template "Launch plan" (id=UT_28Ex1) from the draft. It is in your personal templates. Moving it into the workspace or sharing it failed: Forbidden. Retry with update-template. Use create-project-from-template with this ID to start a new project from it.',
            )
        })
    })

    describe('input rules', () => {
        it.each([
            ['nothing', {}, 'Nothing to save'],
            ['a project and a CSV', { projectId: 'p', csvFileContent: 'TYPE' }, 'not both'],
            ['a CSV and content', { csvFileContent: 'TYPE', content: EDITED }, 'not both'],
        ])('saves nothing when given %s', async (_, source, message) => {
            await expect(
                createTemplate.execute({ ...SAVE, ...source }, mockTodoistApi),
            ).rejects.toThrow(message)
            expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
            expect(mockTodoistApi.createTemplate).not.toHaveBeenCalled()
        })

        it('needs a name and a description to save', async () => {
            await expect(
                createTemplate.execute({ preview: false, projectId: 'project-1' }, mockTodoistApi),
            ).rejects.toThrow('A name and a description are required')
        })
    })
})
