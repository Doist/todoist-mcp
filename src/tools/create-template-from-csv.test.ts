import type { Template, TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { createApiError } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { createTemplateFromCSV } from './create-template-from-csv.js'

const mockTodoistApi = {
    createTemplateFromCSV: vi.fn(),
    previewTemplateFromCSV: vi.fn(),
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
                preview: false,
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
        const file = args?.file

        expect(file).toBeInstanceOf(Blob)

        expect(await (file as Blob).text()).toBe('TYPE,CONTENT\ntask,Plan')
        expect(result.structuredContent).toEqual({ templateId: 'UT_28Ex1', name: 'Launch plan' })
        expect(result.textContent).toBe(
            'Created template "Launch plan" (id=UT_28Ex1) from CSV content. It is in your personal templates. Use create-project-from-template with this ID to start a new project from it.',
        )
    })

    it('uses the given color', async () => {
        await createTemplateFromCSV.execute(
            {
                csvFileContent: 'TYPE,CONTENT',
                preview: false,
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
                {
                    csvFileContent: 'TYPE,CONTENT',
                    preview: false,
                    name: 'Launch plan',
                    description: 'A launch',
                },
                mockTodoistApi,
            ),
        ).rejects.toThrow('502')
        expect(mockTodoistApi.createTemplateFromCSV).toHaveBeenCalledTimes(1)
    })

    describe('draft', () => {
        it('returns the CSV as a draft by default without creating a template', async () => {
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

            const result = await createTemplateFromCSV.execute(
                {
                    csvFileContent: 'TYPE,CONTENT\ntask,Plan',
                    name: 'Launch plan',
                    description: 'A launch',
                },
                mockTodoistApi,
            )

            const [args] = mockTodoistApi.previewTemplateFromCSV.mock.calls[0] ?? []
            const file = args?.file

            expect(file).toBeInstanceOf(Blob)

            expect(await (file as Blob).text()).toBe('TYPE,CONTENT\ntask,Plan')
            expect(mockTodoistApi.createTemplateFromCSV).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual({
                content: {
                    projects: [{ viewStyle: 'list' }],
                    sections: [],
                    tasks: [{ id: 't1', content: 'Plan', priority: 'p4' }],
                    comments: [],
                    projectComments: [],
                    projectViewOptionsDefaults: [],
                },
            })
            expect(result.textContent).toContain(
                'Draft of the CSV as a template, not created: list layout, 0 sections, 1 task.',
            )
            expect(result.textContent).toContain(
                'Before creating it, show the user this draft and ask whether to change anything. Then call create-template-from-csv again with preview: false,',
            )
        })

        it('creates the template from an edited draft instead of the CSV', async () => {
            const result = await createTemplateFromCSV.execute(
                {
                    preview: false,
                    name: 'Launch plan',
                    description: 'A launch',
                    content: {
                        projects: [{ viewStyle: 'board' }],
                        sections: [],
                        tasks: [{ id: 't1', content: 'Plan', priority: 'p1' }],
                        comments: [],
                        projectComments: [],
                        projectViewOptionsDefaults: [],
                    },
                },
                mockTodoistApi,
            )

            const [args] = mockTodoistApi.createTemplateFromCSV.mock.calls[0] ?? []
            expect(args).not.toHaveProperty('file')
            expect(args?.content?.tasks).toEqual([{ id: 't1', content: 'Plan', priority: 4 }])
            expect(result.textContent).toContain('from the edited draft')
        })

        it.each([
            ['neither', {}, 'Provide `csvFileContent`, or the edited `content`'],
            [
                'both',
                {
                    csvFileContent: 'TYPE,CONTENT',
                    content: {
                        projects: [],
                        sections: [],
                        tasks: [],
                        comments: [],
                        projectComments: [],
                        projectViewOptionsDefaults: [],
                    },
                },
                'not both',
            ],
        ])('needs exactly one source to save, not %s', async (_, source, message) => {
            await expect(
                createTemplateFromCSV.execute(
                    { ...source, preview: false, name: 'Launch plan', description: 'A launch' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow(message)
            expect(mockTodoistApi.createTemplateFromCSV).not.toHaveBeenCalled()
        })

        it('creates nothing when given content without preview: false', async () => {
            await expect(
                createTemplateFromCSV.execute(
                    {
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
            ).rejects.toThrow('To create the template from `content`, pass preview: false')
            expect(mockTodoistApi.previewTemplateFromCSV).not.toHaveBeenCalled()
            expect(mockTodoistApi.createTemplateFromCSV).not.toHaveBeenCalled()
        })

        it('needs a name and a description to create the template', async () => {
            await expect(
                createTemplateFromCSV.execute(
                    { csvFileContent: 'TYPE,CONTENT', preview: false },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('A name and a description are required')
        })
    })
})
