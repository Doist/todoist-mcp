import type { Template, TemplateContent, TodoistApi, Workspace } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'
import { updateTemplate } from './update-template.js'

const mockTodoistApi = {
    updateTemplate: vi.fn(),
    getTemplateContent: vi.fn(),
    getWorkspaces: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_TEMPLATE } = ToolNames

function createTemplate(overrides: Partial<Template> = {}): Template {
    return {
        id: 'UT_28Ex1',
        name: 'Launch plan',
        templateType: 'project',
        templateSource: 'user',
        shortDescription: '',
        longDescription: '',
        instructions: null,
        thumbnailImage: null,
        thumbnailImageDark: null,
        coverImage: null,
        previewImage: null,
        templateColor: 'blue',
        backgroundColor: null,
        backgroundColorDark: null,
        creator: null,
        seo: null,
        moreResources: [],
        categoryIds: [],
        workspaceId: null,
        sharedWithWorkspaceMembers: false,
        ...overrides,
    }
}

describe(`${UPDATE_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        workspaceResolver.clearCache()
        mockTodoistApi.updateTemplate.mockResolvedValue(createTemplate({ name: 'Renamed' }))
    })

    it('sends only the fields to change', async () => {
        const result = await updateTemplate.execute(
            { templateId: 'UT_28Ex1', name: 'Renamed', color: 'blue' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.updateTemplate).toHaveBeenCalledWith('UT_28Ex1', {
            name: 'Renamed',
            description: undefined,
            color: 'blue',
            projectId: undefined,
            workspaceId: undefined,
            sharedWithWorkspaceMembers: undefined,
        })
        expect(result.structuredContent).toEqual({
            templateId: 'UT_28Ex1',
            name: 'Renamed',
            sharedWithWorkspaceMembers: false,
        })
        expect(result.textContent).toBe(
            'Updated template "Renamed" (id=UT_28Ex1). It is a personal template.',
        )
    })

    it('resolves the workspace by name and reports sharing', async () => {
        mockTodoistApi.getWorkspaces.mockResolvedValue([
            { id: '111', name: 'Engineering' } as Workspace,
        ])
        mockTodoistApi.updateTemplate.mockResolvedValue(
            createTemplate({ workspaceId: '111', sharedWithWorkspaceMembers: true }),
        )

        const result = await updateTemplate.execute(
            {
                templateId:
                    'https://app.todoist.com/app/templates/category/my-templates/UT_28Ex1/view',
                workspace: 'Engineering',
                sharedWithWorkspaceMembers: true,
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.updateTemplate).toHaveBeenCalledWith(
            'UT_28Ex1',
            expect.objectContaining({ workspaceId: '111', sharedWithWorkspaceMembers: true }),
        )
        expect(result.textContent).toContain('in workspace (id=111) and shared with its members.')
    })

    it("replaces the template's content from a project", async () => {
        await updateTemplate.execute(
            { templateId: 'UT_28Ex1', projectId: 'project-1' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.updateTemplate).toHaveBeenCalledWith(
            'UT_28Ex1',
            expect.objectContaining({ projectId: 'project-1', name: undefined }),
        )
    })

    it('stops sharing when that is the only change', async () => {
        mockTodoistApi.updateTemplate.mockResolvedValue(
            createTemplate({ workspaceId: '111', sharedWithWorkspaceMembers: false }),
        )

        const result = await updateTemplate.execute(
            { templateId: 'UT_28Ex1', sharedWithWorkspaceMembers: false },
            mockTodoistApi,
        )

        expect(mockTodoistApi.updateTemplate).toHaveBeenCalledWith(
            'UT_28Ex1',
            expect.objectContaining({ sharedWithWorkspaceMembers: false }),
        )
        expect(result.textContent).toContain('not shared with its members')
    })

    it('refuses to edit a gallery template', async () => {
        await expect(
            updateTemplate.execute({ templateId: 'product-launch', name: 'Mine' }, mockTodoistApi),
        ).rejects.toThrow('is not a saved template ID')
        expect(mockTodoistApi.updateTemplate).not.toHaveBeenCalled()
    })

    it('refuses a call that changes nothing', async () => {
        await expect(
            updateTemplate.execute({ templateId: 'UT_28Ex1' }, mockTodoistApi),
        ).rejects.toThrow('Nothing to update')
        expect(mockTodoistApi.updateTemplate).not.toHaveBeenCalled()
    })

    describe('content', () => {
        const CURRENT: TemplateContent = {
            projects: [{ viewStyle: 'list', description: '', icon: null }],
            sections: [],
            tasks: [
                {
                    id: 't1',
                    content: 'Plan',
                    priority: 4,
                    due: { string: 'every monday', lang: 'en' },
                },
                { id: 't2', content: 'Review', priority: 1 },
            ],
            comments: [{ taskId: 't1', content: 'Check this', postedUid: '1' }],
            projectComments: [],
            projectViewOptionsDefaults: [],
        }

        beforeEach(() => {
            mockTodoistApi.getTemplateContent.mockResolvedValue({
                templateType: 'project',
                workspaceId: null,
                content: CURRENT,
            })
            // After a save, report what was sent unless a test says the backend stored something else.
            mockTodoistApi.updateTemplate.mockImplementation(async (_id, args) => {
                if (args.content) {
                    mockTodoistApi.getTemplateContent.mockResolvedValue({
                        templateType: 'project',
                        workspaceId: null,
                        content: args.content,
                    })
                }
                return createTemplate({ name: 'Renamed' })
            })
        })

        it('sends the edited content, converting priorities, and reports what changed', async () => {
            const result = await updateTemplate.execute(
                {
                    templateId: 'UT_28Ex1',
                    content: {
                        projects: [{ viewStyle: 'calendar', description: '' }],
                        sections: [],
                        tasks: [
                            {
                                id: 't1',
                                content: 'Plan',
                                priority: 'p1',
                                due: { string: 'every monday', lang: 'en' },
                            },
                            { id: 't2', content: 'Review', priority: 'p4' },
                            { id: 'new', content: 'Celebrate' },
                        ],
                        comments: [{ taskId: 't1', content: 'Check this', postedUid: '1' }],
                        projectComments: [],
                        projectViewOptionsDefaults: [],
                    },
                },
                mockTodoistApi,
            )

            const [, args] = mockTodoistApi.updateTemplate.mock.calls[0] ?? []
            expect(args?.content?.projects).toEqual([{ viewStyle: 'calendar', description: '' }])
            expect(args?.content?.tasks).toEqual([
                {
                    id: 't1',
                    content: 'Plan',
                    priority: 4,
                    due: { string: 'every monday', lang: 'en' },
                },
                { id: 't2', content: 'Review', priority: 1 },
                { id: 'new', content: 'Celebrate' },
            ])
            expect(result.textContent).toContain(
                'Content: layout list → calendar, sections 0 → 0, tasks 2 → 3, assigned tasks 0 → 0, comments 1 → 1.',
            )
        })

        it('shows a dropped task in the reply', async () => {
            const result = await updateTemplate.execute(
                {
                    templateId: 'UT_28Ex1',
                    content: {
                        projects: [{ viewStyle: 'list' }],
                        sections: [],
                        tasks: [{ id: 't1', content: 'Plan' }],
                        comments: [],
                        projectComments: [],
                        projectViewOptionsDefaults: [],
                    },
                },
                mockTodoistApi,
            )

            expect(result.textContent).toContain(
                'tasks 2 → 1, assigned tasks 0 → 0, comments 1 → 0',
            )
        })

        it('reports an assignee the backend dropped on save', async () => {
            const withAssignee = {
                ...CURRENT,
                tasks: [{ id: 't1', content: 'Plan', responsibleUid: '42' }],
            }
            mockTodoistApi.getTemplateContent.mockResolvedValueOnce({
                templateType: 'project',
                workspaceId: '486413',
                content: withAssignee,
            })
            mockTodoistApi.updateTemplate.mockImplementationOnce(async () => {
                mockTodoistApi.getTemplateContent.mockResolvedValueOnce({
                    templateType: 'project',
                    workspaceId: '486413',
                    content: { ...withAssignee, tasks: [{ id: 'x', content: 'Plan' }] },
                })
                return createTemplate()
            })

            const result = await updateTemplate.execute(
                {
                    templateId: 'UT_28Ex1',
                    content: {
                        projects: [{ viewStyle: 'list' }],
                        sections: [],
                        tasks: [{ id: 't1', content: 'Plan', responsibleUid: '42' }],
                        comments: [],
                        projectComments: [],
                        projectViewOptionsDefaults: [],
                    },
                },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('assigned tasks 1 → 0')
        })

        it('refuses content together with projectId before reading or writing', async () => {
            await expect(
                updateTemplate.execute(
                    {
                        templateId: 'UT_28Ex1',
                        projectId: 'project-1',
                        content: {
                            projects: [],
                            sections: [],
                            tasks: [],
                            comments: [],
                            projectComments: [],
                            projectViewOptionsDefaults: [],
                        },
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('either `content` or `projectId`')
            expect(mockTodoistApi.getTemplateContent).not.toHaveBeenCalled()
            expect(mockTodoistApi.updateTemplate).not.toHaveBeenCalled()
        })

        it('does not read the content when only metadata changes', async () => {
            await updateTemplate.execute(
                { templateId: 'UT_28Ex1', name: 'Renamed' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getTemplateContent).not.toHaveBeenCalled()
        })
    })
})
