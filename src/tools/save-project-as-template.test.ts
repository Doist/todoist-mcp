import type { Template, TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { createApiError, createMockProject } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { saveProjectAsTemplate } from './save-project-as-template.js'

const mockTodoistApi = {
    saveProjectAsTemplate: vi.fn(),
    previewProjectAsTemplate: vi.fn(),
    getProject: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { SAVE_PROJECT_AS_TEMPLATE } = ToolNames

function createTemplate(overrides: Partial<Template> = {}): Template {
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

describe(`${SAVE_PROJECT_AS_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.saveProjectAsTemplate.mockResolvedValue(createTemplate())
        mockTodoistApi.getProject.mockResolvedValue(
            createMockProject({ id: 'project-1', color: 'berry_red' }),
        )
    })

    it('saves a personal template in the given color without reading the project', async () => {
        const result = await saveProjectAsTemplate.execute(
            {
                projectId: 'project-1',
                preview: false,
                name: 'Launch plan',
                description: 'Everything for a launch',
                color: 'blue',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
        expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith({
            projectId: 'project-1',
            name: 'Launch plan',
            description: 'Everything for a launch',
            color: 'blue',
            forWorkspace: undefined,
        })
        expect(result.structuredContent).toEqual({ templateId: 'UT_28Ex1', name: 'Launch plan' })
        expect(result.textContent).toBe(
            'Saved project (id=project-1) as template "Launch plan" (id=UT_28Ex1). It is in your personal templates. Use create-project-from-template with this ID to start a new project from it.',
        )
    })

    it("defaults the color to the project's color", async () => {
        await saveProjectAsTemplate.execute(
            {
                projectId: 'project-1',
                preview: false,
                name: 'Launch plan',
                description: 'A launch',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProject).toHaveBeenCalledWith('project-1')
        expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith(
            expect.objectContaining({ color: 'berry_red' }),
        )
    })

    it('saves to the workspace and says it is not shared yet', async () => {
        mockTodoistApi.saveProjectAsTemplate.mockResolvedValue(
            createTemplate({ workspaceId: '111' }),
        )

        const result = await saveProjectAsTemplate.execute(
            {
                projectId: 'project-1',
                preview: false,
                name: 'Launch plan',
                description: 'A launch',
                color: 'blue',
                saveToWorkspace: true,
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith(
            expect.objectContaining({ forWorkspace: true }),
        )
        expect(result.structuredContent).toEqual({
            templateId: 'UT_28Ex1',
            name: 'Launch plan',
            workspaceId: '111',
        })
        expect(result.textContent).toContain(
            "It is in the workspace's templates (workspace id=111), not yet shared with members.",
        )
    })

    it('falls back to charcoal when the project color is not one it recognizes', async () => {
        mockTodoistApi.getProject.mockResolvedValue(
            createMockProject({ id: 'project-1', color: 'not-a-color' as never }),
        )

        await saveProjectAsTemplate.execute(
            {
                projectId: 'project-1',
                preview: false,
                name: 'Launch plan',
                description: 'A launch',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledWith(
            expect.objectContaining({ color: 'charcoal' }),
        )
    })

    it('saves nothing when the project cannot be read for its color', async () => {
        mockTodoistApi.getProject.mockRejectedValue(
            createApiError({ status: 404, error: 'Project not found' }),
        )

        await expect(
            saveProjectAsTemplate.execute(
                {
                    projectId: 'missing',
                    preview: false,
                    name: 'Launch plan',
                    description: 'A launch',
                },
                mockTodoistApi,
            ),
        ).rejects.toThrow('404')
        expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
    })

    it('says a workspace template is shared when the API reports it shared', async () => {
        mockTodoistApi.saveProjectAsTemplate.mockResolvedValue(
            createTemplate({ workspaceId: '111', sharedWithWorkspaceMembers: true }),
        )

        const result = await saveProjectAsTemplate.execute(
            {
                projectId: 'project-1',
                preview: false,
                name: 'Launch plan',
                description: 'A launch',
                color: 'blue',
                saveToWorkspace: true,
            },
            mockTodoistApi,
        )

        expect(result.textContent).toContain(
            "It is in the workspace's templates (workspace id=111), shared with members.",
        )
    })

    it('retries the save after a 503', async () => {
        vi.useFakeTimers()
        try {
            mockTodoistApi.saveProjectAsTemplate
                .mockRejectedValueOnce(
                    createApiError({ status: 503, error: 'Service Unavailable' }),
                )
                .mockResolvedValueOnce(createTemplate())

            const promise = saveProjectAsTemplate.execute(
                {
                    projectId: 'project-1',
                    preview: false,
                    name: 'Launch plan',
                    description: 'A launch',
                    color: 'blue',
                },
                mockTodoistApi,
            )
            await vi.runAllTimersAsync()
            const result = await promise

            expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledTimes(2)
            expect(result.structuredContent.templateId).toBe('UT_28Ex1')
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not retry the save after a 502, since the template may already exist', async () => {
        mockTodoistApi.saveProjectAsTemplate.mockRejectedValue(
            createApiError({ status: 502, error: 'Bad gateway' }),
        )

        await expect(
            saveProjectAsTemplate.execute(
                {
                    projectId: 'project-1',
                    preview: false,
                    name: 'Launch plan',
                    description: 'A launch',
                    color: 'blue',
                },
                mockTodoistApi,
            ),
        ).rejects.toThrow('502')
        expect(mockTodoistApi.saveProjectAsTemplate).toHaveBeenCalledTimes(1)
    })

    describe('draft', () => {
        const DRAFT = {
            projects: [{ viewStyle: 'board' as const, description: null, icon: null }],
            sections: [{ id: 's1', name: 'Week 1', description: null }],
            tasks: [
                { id: 't1', content: 'Plan', sectionId: 's1', priority: 4 },
                { id: 't2', content: 'Details', parentId: 't1', priority: 1 },
            ],
            comments: [],
            projectComments: [],
            projectViewOptionsDefaults: [],
        }

        it('returns the draft by default without saving anything', async () => {
            mockTodoistApi.previewProjectAsTemplate.mockResolvedValue({
                templateType: 'project',
                workspaceId: null,
                content: DRAFT,
            })

            const result = await saveProjectAsTemplate.execute(
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
                'Draft of project (id=project-1) as a template, not saved: board layout, 1 section, 2 tasks.\n- Plan [Week 1]\n    - Details\nBefore saving, show the user this draft and ask whether to change anything. Then call save-project-as-template again with preview: false, a name and description, and the edited `content` if it changed.',
            )
        })

        it('saves an edited draft instead of the project as it is', async () => {
            await saveProjectAsTemplate.execute(
                {
                    projectId: 'project-1',
                    preview: false,
                    name: 'Launch plan',
                    description: 'A launch',
                    color: 'blue',
                    content: {
                        projects: [{ viewStyle: 'list' }],
                        sections: [],
                        tasks: [{ id: 't1', content: 'Plan', priority: 'p1' }],
                        comments: [],
                        projectComments: [],
                        projectViewOptionsDefaults: [],
                    },
                },
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

        it('saves nothing when given content without preview: false', async () => {
            await expect(
                saveProjectAsTemplate.execute(
                    {
                        projectId: 'project-1',
                        name: 'Launch plan',
                        description: 'A launch',
                        content: {
                            projects: [{ viewStyle: 'list' }],
                            sections: [],
                            tasks: [],
                            comments: [],
                            projectComments: [],
                            projectViewOptionsDefaults: [],
                        },
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('To save `content`, pass preview: false')
            expect(mockTodoistApi.previewProjectAsTemplate).not.toHaveBeenCalled()
            expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
        })

        it('needs a name and a description to save', async () => {
            await expect(
                saveProjectAsTemplate.execute(
                    { projectId: 'project-1', preview: false },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('A name and a description are required')
            expect(mockTodoistApi.saveProjectAsTemplate).not.toHaveBeenCalled()
        })
    })
})
