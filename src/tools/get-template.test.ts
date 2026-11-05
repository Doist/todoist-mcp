import type { Template, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { getTemplate } from './get-template.js'

const mockTodoistApi = {
    getTemplate: vi.fn(),
    getTemplateContent: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { GET_TEMPLATE } = ToolNames

const TEMPLATE: Template = {
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
    templateColor: 'sky_blue',
    backgroundColor: null,
    backgroundColorDark: null,
    creator: null,
    seo: null,
    moreResources: [],
    categoryIds: [],
    workspaceId: '486413',
    sharedWithWorkspaceMembers: false,
    canEdit: true,
}

describe(`${GET_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getTemplate.mockResolvedValue(TEMPLATE)
        mockTodoistApi.getTemplateContent.mockResolvedValue({
            templateType: 'project',
            workspaceId: '486413',
            content: {
                projects: [{ viewStyle: 'board', description: null, icon: null }],
                sections: [{ id: 's1', name: 'Week 1', description: null }],
                tasks: [
                    {
                        id: 't1',
                        content: 'Plan',
                        sectionId: 's1',
                        parentId: null,
                        priority: 4,
                        due: { string: 'every monday', lang: 'en' },
                        responsibleUid: '42',
                    },
                    { id: 't2', content: 'Details', parentId: 't1', priority: 1 },
                ],
                comments: [{ taskId: 't1', content: 'Check this', postedUid: null }],
                projectComments: [],
                projectViewOptionsDefaults: [],
            },
        })
    })

    it('returns the details and the content in the shape update-template takes', async () => {
        const result = await getTemplate.execute(
            {
                templateId:
                    'https://app.todoist.com/app/templates/category/my-templates/UT_28Ex1/view',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getTemplate).toHaveBeenCalledWith('UT_28Ex1', { locale: undefined })
        expect(result.structuredContent).toMatchObject({
            templateId: 'UT_28Ex1',
            name: 'Launch plan',
            color: 'sky_blue',
            source: 'user',
            workspaceId: '486413',
            canEdit: true,
        })
        expect(result.structuredContent.content.projects).toEqual([{ viewStyle: 'board' }])
        expect(result.structuredContent.content.tasks).toEqual([
            {
                id: 't1',
                content: 'Plan',
                sectionId: 's1',
                priority: 'p1',
                due: { string: 'every monday', lang: 'en' },
                responsibleUid: '42',
            },
            { id: 't2', content: 'Details', parentId: 't1', priority: 'p4' },
        ])
        expect(result.structuredContent.content.comments).toEqual([
            { taskId: 't1', content: 'Check this' },
        ])
    })

    it('outlines the tasks in the text reply', async () => {
        const result = await getTemplate.execute({ templateId: 'UT_28Ex1' }, mockTodoistApi)

        expect(result.textContent).toBe(
            'Template "Launch plan" (id=UT_28Ex1): board layout, 1 section, 2 tasks.\n- Plan [Week 1] (due every monday)\n    - Details',
        )
    })
})
