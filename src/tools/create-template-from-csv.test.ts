import type { Template, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createApiError } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { createTemplateFromCSV } from './create-template-from-csv.js'

const mockTodoistApi = {
    createTemplateFromCSV: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { CREATE_TEMPLATE_FROM_CSV } = ToolNames

const TEMPLATE: Template = {
    id: 'UT_28Ex1',
    name: 'Launch plan',
    templateType: 'project',
    templateSource: 'user',
    shortDescription: 'A launch',
    longDescription: 'A launch',
    instructions: null,
    thumbnailImage: null,
    thumbnailImageDark: null,
    coverImage: null,
    previewImage: null,
    templateColor: 'charcoal',
    backgroundColor: null,
    backgroundColorDark: null,
    creator: { userId: '1', name: 'Ada', position: '', avatar: '' },
    seo: null,
    moreResources: [],
    categoryIds: [],
    workspaceId: null,
    sharedWithWorkspaceMembers: false,
}

describe(`${CREATE_TEMPLATE_FROM_CSV} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.createTemplateFromCSV.mockResolvedValue(TEMPLATE)
    })

    it('uploads the CSV as a file and defaults the color to charcoal', async () => {
        const result = await createTemplateFromCSV.execute(
            {
                csvFileContent: 'TYPE,CONTENT\ntask,Plan',
                name: 'Launch plan',
                description: 'A launch',
            },
            mockTodoistApi,
        )

        const [args] = mockTodoistApi.createTemplateFromCSV.mock.calls[0] ?? []
        expect(args).toMatchObject({
            fileName: 'template.csv',
            name: 'Launch plan',
            description: 'A launch',
            color: 'charcoal',
        })
        expect(args?.file).toBeInstanceOf(Blob)
        expect(await (args?.file as Blob).text()).toBe('TYPE,CONTENT\ntask,Plan')
        expect(result.structuredContent).toEqual({ templateId: 'UT_28Ex1', name: 'Launch plan' })
        expect(result.textContent).toBe(
            'Created template "Launch plan" (id=UT_28Ex1) from CSV content. It is in your personal templates. Use create-project-from-template with this ID to start a new project from it.',
        )
    })

    it('uses the given color', async () => {
        await createTemplateFromCSV.execute(
            {
                csvFileContent: 'TYPE,CONTENT',
                name: 'Launch plan',
                description: 'A launch',
                color: 'blue',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.createTemplateFromCSV).toHaveBeenCalledWith(
            expect.objectContaining({ color: 'blue' }),
        )
    })

    it('does not retry after a 502, since the template may already exist', async () => {
        mockTodoistApi.createTemplateFromCSV.mockRejectedValue(
            createApiError({ status: 502, error: 'Bad gateway' }),
        )

        await expect(
            createTemplateFromCSV.execute(
                { csvFileContent: 'TYPE,CONTENT', name: 'Launch plan', description: 'A launch' },
                mockTodoistApi,
            ),
        ).rejects.toThrow('502')
        expect(mockTodoistApi.createTemplateFromCSV).toHaveBeenCalledTimes(1)
    })
})
