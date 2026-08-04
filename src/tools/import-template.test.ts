import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockSection, createMockTask, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { extractTemplateId, importTemplate } from './import-template.js'

const mockTodoistApi = {
    importTemplateFromId: vi.fn(),
    importTemplateIntoProject: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { IMPORT_TEMPLATE } = ToolNames

function createImportResponse(overrides: Record<string, unknown> = {}) {
    return {
        status: 'ok',
        templateType: 'project',
        projects: [],
        sections: [],
        tasks: [],
        comments: [],
        ...overrides,
    }
}

describe(`${IMPORT_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('extractTemplateId', () => {
        it.each([
            {
                name: 'a bare gallery slug',
                input: 'product-launch',
                expected: 'product-launch',
            },
            {
                name: 'a bare personal template ID',
                input: 'UT_28ExampleTemplateId000001',
                expected: 'UT_28ExampleTemplateId000001',
            },
            {
                name: 'a public gallery URL',
                input: 'https://www.todoist.com/templates/product-launch',
                expected: 'product-launch',
            },
            {
                name: 'an in-app personal template URL ending in /view',
                input: 'https://app.todoist.com/app/templates/category/my-templates/UT_28ExampleTemplateId000001/view',
                expected: 'UT_28ExampleTemplateId000001',
            },
            {
                name: 'a local dev URL',
                input: 'https://local.todoist.com/app/templates/category/my-templates/UT_28ExampleTemplateId000002/view',
                expected: 'UT_28ExampleTemplateId000002',
            },
            {
                name: 'a URL with query and hash',
                input: 'https://www.todoist.com/templates/product-launch?ref=nav#top',
                expected: 'product-launch',
            },
            {
                name: 'a URL with a trailing slash',
                input: 'https://www.todoist.com/templates/product-launch/',
                expected: 'product-launch',
            },
            {
                name: 'surrounding whitespace',
                input: '  product-launch  ',
                expected: 'product-launch',
            },
        ])('should resolve $name', ({ input, expected }) => {
            expect(extractTemplateId(input)).toBe(expected)
        })
    })

    describe('importing by template ID', () => {
        it('should import a gallery template and summarize what was created', async () => {
            mockTodoistApi.importTemplateFromId.mockResolvedValue(
                createImportResponse({
                    sections: [createMockSection({ id: TEST_IDS.SECTION_1, name: 'Websites' })],
                    tasks: [
                        createMockTask({ id: TEST_IDS.TASK_1, content: 'Home page' }),
                        createMockTask({ id: TEST_IDS.TASK_2, content: 'Product page' }),
                    ],
                }),
            )

            const result = await importTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST, templateId: 'product-launch' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.importTemplateFromId).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
                templateId: 'product-launch',
                locale: undefined,
            })
            expect(result.structuredContent?.totalCount).toBe(3)
            expect(result.textContent).toContain('1 section, 2 tasks')
        })

        it('should reduce a template URL to its ID before calling the API', async () => {
            mockTodoistApi.importTemplateFromId.mockResolvedValue(createImportResponse())

            await importTemplate.execute(
                {
                    projectId: TEST_IDS.PROJECT_TEST,
                    templateId:
                        'https://app.todoist.com/app/templates/category/my-templates/UT_28ExampleTemplateId000001/view',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.importTemplateFromId).toHaveBeenCalledWith(
                expect.objectContaining({ templateId: 'UT_28ExampleTemplateId000001' }),
            )
        })

        it('should pass locale through', async () => {
            mockTodoistApi.importTemplateFromId.mockResolvedValue(createImportResponse())

            await importTemplate.execute(
                {
                    projectId: TEST_IDS.PROJECT_TEST,
                    templateId: 'product-launch',
                    locale: 'de',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.importTemplateFromId).toHaveBeenCalledWith(
                expect.objectContaining({ locale: 'de' }),
            )
        })

        it('should report an import that created nothing', async () => {
            mockTodoistApi.importTemplateFromId.mockResolvedValue(createImportResponse())

            const result = await importTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST, templateId: 'product-launch' },
                mockTodoistApi,
            )

            expect(result.structuredContent?.totalCount).toBe(0)
            expect(result.textContent).toContain('created nothing')
        })
    })

    describe('importing by CSV content', () => {
        it('should import raw template content into the project', async () => {
            mockTodoistApi.importTemplateIntoProject.mockResolvedValue(
                createImportResponse({
                    tasks: [createMockTask({ id: TEST_IDS.TASK_1, content: 'Buy milk' })],
                }),
            )

            const result = await importTemplate.execute(
                {
                    projectId: TEST_IDS.PROJECT_TEST,
                    file: 'TYPE,CONTENT\ntask,Buy milk',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.importTemplateIntoProject).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
                file: 'TYPE,CONTENT\ntask,Buy milk',
                fileName: 'template.csv',
            })
            expect(mockTodoistApi.importTemplateFromId).not.toHaveBeenCalled()
            expect(result.textContent).toContain('1 task')
        })
    })

    describe('source validation', () => {
        it('should reject a call with both templateId and file', async () => {
            await expect(
                importTemplate.execute(
                    {
                        projectId: TEST_IDS.PROJECT_TEST,
                        templateId: 'product-launch',
                        file: 'TYPE,CONTENT',
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('exactly one template source')

            expect(mockTodoistApi.importTemplateFromId).not.toHaveBeenCalled()
            expect(mockTodoistApi.importTemplateIntoProject).not.toHaveBeenCalled()
        })

        it('should reject a call with neither templateId nor file', async () => {
            await expect(
                importTemplate.execute({ projectId: TEST_IDS.PROJECT_TEST }, mockTodoistApi),
            ).rejects.toThrow('exactly one template source')
        })
    })

    it('should propagate import errors', async () => {
        mockTodoistApi.importTemplateFromId.mockRejectedValue(
            new Error('HTTP 403: The user is not allowed to view this template'),
        )

        await expect(
            importTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST, templateId: 'UT_someoneElses' },
                mockTodoistApi,
            ),
        ).rejects.toThrow('not allowed to view this template')
    })
})
