import type { Template, TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { findTemplates } from './find-templates.js'

const mockTodoistApi = {
    getTemplates: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_TEMPLATES } = ToolNames

function createTemplate(overrides: Partial<Template> = {}): Template {
    return {
        id: 'product-launch',
        name: 'Product launch',
        templateType: 'project',
        templateSource: 'todoist',
        shortDescription: 'Plan a launch from start to finish',
        longDescription: 'A longer description that the list leaves out.',
        instructions: null,
        thumbnailImage: null,
        thumbnailImageDark: null,
        coverImage: null,
        previewImage: null,
        templateColor: null,
        backgroundColor: null,
        backgroundColorDark: null,
        creator: null,
        seo: null,
        moreResources: [],
        categoryIds: [],
        ...overrides,
    }
}

describe(`${FIND_TEMPLATES} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('searches every source for project templates by default', async () => {
        mockTodoistApi.getTemplates.mockResolvedValue({
            results: [
                createTemplate(),
                createTemplate({
                    id: 'UT_28Ex1',
                    name: 'Team launch',
                    templateSource: 'user',
                    shortDescription: 'Our own launch checklist',
                    workspaceId: '486413',
                }),
            ],
            nextCursor: null,
        })

        const result = await findTemplates.execute({ query: 'launch' }, mockTodoistApi)

        expect(mockTodoistApi.getTemplates).toHaveBeenCalledWith({
            query: 'launch',
            templateSource: 'all',
            templateType: 'project',
            locale: undefined,
            cursor: undefined,
            limit: 20,
        })
        expect(result.structuredContent).toEqual({
            templates: [
                {
                    templateId: 'product-launch',
                    name: 'Product launch',
                    description: 'Plan a launch from start to finish',
                    source: 'todoist',
                },
                {
                    templateId: 'UT_28Ex1',
                    name: 'Team launch',
                    description: 'Our own launch checklist',
                    source: 'user',
                    workspaceId: '486413',
                },
            ],
        })
        expect(result.textContent).toBe(
            'Found 2 templates matching "launch":\n' +
                '- Product launch (id=product-launch, gallery): Plan a launch from start to finish\n' +
                '- Team launch (id=UT_28Ex1, workspace 486413): Our own launch checklist',
        )
    })

    it('passes the source, locale, limit and cursor through, and reports the next page', async () => {
        mockTodoistApi.getTemplates.mockResolvedValue({
            results: [createTemplate({ id: 'UT_1', name: 'Mine', templateSource: 'user' })],
            nextCursor: 'next-page',
        })

        const result = await findTemplates.execute(
            { source: 'user', locale: 'de', limit: 5, cursor: 'this-page' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getTemplates).toHaveBeenCalledWith({
            query: undefined,
            templateSource: 'user',
            templateType: 'project',
            locale: 'de',
            cursor: 'this-page',
            limit: 5,
        })
        expect(result.structuredContent?.nextCursor).toBe('next-page')
        expect(result.textContent).toBe(
            'Found 1 template:\n' +
                '- Mine (id=UT_1, personal): Plan a launch from start to finish\n' +
                'More results: call find-templates again with cursor "next-page".',
        )
    })

    it('says when nothing matches', async () => {
        mockTodoistApi.getTemplates.mockResolvedValue({ results: [], nextCursor: null })

        const result = await findTemplates.execute({ query: 'zzz' }, mockTodoistApi)

        expect(result.structuredContent).toEqual({ templates: [] })
        expect(result.textContent).toBe('No templates found matching "zzz".')
    })
})
