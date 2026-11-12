import type { TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { createMockSection, createMockTask, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { importIntoProject } from './import-into-project.js'

const mockTodoistApi = {
    importTemplateFromId: vi.fn(),
    importCSVIntoProject: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { IMPORT_INTO_PROJECT } = ToolNames

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

describe(`${IMPORT_INTO_PROJECT} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('importing a template by ID', () => {
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

            const result = await importIntoProject.execute(
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
            expect(result.structuredContent?.sections).toEqual([
                expect.objectContaining({ id: TEST_IDS.SECTION_1, name: 'Websites' }),
            ])
            expect(result.structuredContent?.tasks).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: TEST_IDS.TASK_1, content: 'Home page' }),
                    expect.objectContaining({ id: TEST_IDS.TASK_2, content: 'Product page' }),
                ]),
            )
        })

        it('should count imported projects toward totalCount even though they are not returned', async () => {
            mockTodoistApi.importTemplateFromId.mockResolvedValue(
                createImportResponse({
                    projects: [{ id: 'imported-project' }],
                    tasks: [createMockTask({ id: TEST_IDS.TASK_1, content: 'Home page' })],
                }),
            )

            const result = await importIntoProject.execute(
                { projectId: TEST_IDS.PROJECT_TEST, templateId: 'product-launch' },
                mockTodoistApi,
            )

            expect(result.structuredContent?.totalCount).toBe(2)
            expect(result.structuredContent).not.toHaveProperty('projects')
            expect(result.textContent).toContain('1 project')
        })

        it('should reduce a template URL to its ID before calling the API', async () => {
            mockTodoistApi.importTemplateFromId.mockResolvedValue(createImportResponse())

            await importIntoProject.execute(
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

            await importIntoProject.execute(
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

            const result = await importIntoProject.execute(
                { projectId: TEST_IDS.PROJECT_TEST, templateId: 'product-launch' },
                mockTodoistApi,
            )

            expect(result.structuredContent?.totalCount).toBe(0)
            expect(result.textContent).toContain('created nothing')
        })

        it('should propagate import errors', async () => {
            mockTodoistApi.importTemplateFromId.mockRejectedValue(
                new Error('HTTP 403: The user is not allowed to view this template'),
            )

            await expect(
                importIntoProject.execute(
                    { projectId: TEST_IDS.PROJECT_TEST, templateId: 'UT_someoneElses' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('not allowed to view this template')
        })
    })

    describe('importing CSV content', () => {
        it('should import CSV content into the project', async () => {
            mockTodoistApi.importCSVIntoProject.mockResolvedValue(
                createImportResponse({
                    tasks: [createMockTask({ id: TEST_IDS.TASK_1, content: 'Buy milk' })],
                }),
            )

            const result = await importIntoProject.execute(
                {
                    projectId: TEST_IDS.PROJECT_TEST,
                    csvFileContent: 'TYPE,CONTENT\ntask,Buy milk',
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.importCSVIntoProject).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
                file: expect.any(Blob),
                fileName: 'template.csv',
            })
            const file = mockTodoistApi.importCSVIntoProject.mock.calls[0]?.[0].file as Blob
            expect(await file.text()).toBe('TYPE,CONTENT\ntask,Buy milk')
            expect(result.textContent).toBe(
                `Imported CSV into project (id=${TEST_IDS.PROJECT_TEST}): 1 task.`,
            )
            expect(result.structuredContent?.tasks).toEqual([
                expect.objectContaining({ id: TEST_IDS.TASK_1, content: 'Buy milk' }),
            ])
        })

        it('should propagate CSV import errors', async () => {
            mockTodoistApi.importCSVIntoProject.mockRejectedValue(
                new Error('HTTP 400: Invalid CSV'),
            )

            await expect(
                importIntoProject.execute(
                    { projectId: TEST_IDS.PROJECT_TEST, csvFileContent: 'not,a,template' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Invalid CSV')
        })
    })

    describe('source validation', () => {
        it('should reject a call with both templateId and csvFileContent', async () => {
            await expect(
                importIntoProject.execute(
                    {
                        projectId: TEST_IDS.PROJECT_TEST,
                        templateId: 'product-launch',
                        csvFileContent: 'TYPE,CONTENT',
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('exactly one source')

            expect(mockTodoistApi.importTemplateFromId).not.toHaveBeenCalled()
            expect(mockTodoistApi.importCSVIntoProject).not.toHaveBeenCalled()
        })

        it('should reject a call with neither templateId nor csvFileContent', async () => {
            await expect(
                importIntoProject.execute({ projectId: TEST_IDS.PROJECT_TEST }, mockTodoistApi),
            ).rejects.toThrow('exactly one source')
        })
    })
})
