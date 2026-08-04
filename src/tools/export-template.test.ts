import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { exportTemplate } from './export-template.js'

const mockTodoistApi = {
    exportTemplateAsFile: vi.fn(),
    exportTemplateAsUrl: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { EXPORT_TEMPLATE } = ToolNames

const CSV_HEADER = 'TYPE,CONTENT,DESCRIPTION,PRIORITY'

describe(`${EXPORT_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('exporting as a file', () => {
        it('should return the CSV content and row count', async () => {
            const csv = `${CSV_HEADER}\ntask,Buy milk,,4`
            mockTodoistApi.exportTemplateAsFile.mockResolvedValue(csv)

            const result = await exportTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST, format: 'file' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.exportTemplateAsFile).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
                useRelativeDates: undefined,
            })
            expect(result.structuredContent).toEqual({
                format: 'file',
                content: csv,
                lineCount: 2,
            })
            expect(result.textContent).toContain('2 rows')
            expect(result.textContent).toContain('Buy milk')
        })

        it('should preview only the first rows of a long export', async () => {
            const rows = Array.from({ length: 12 }, (_, index) => `task,Task ${index + 1},,4`)
            mockTodoistApi.exportTemplateAsFile.mockResolvedValue([CSV_HEADER, ...rows].join('\n'))

            const result = await exportTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST, format: 'file' },
                mockTodoistApi,
            )

            expect(result.structuredContent?.lineCount).toBe(13)
            // Preview stops at 5 rows so a large project is not spelled out twice.
            expect(result.textContent).toContain('Task 4')
            expect(result.textContent).not.toContain('Task 12')
            expect(result.textContent).toContain('8 more rows')
        })

        it('should default to the file format when none is given', async () => {
            mockTodoistApi.exportTemplateAsFile.mockResolvedValue(`${CSV_HEADER}\ntask,Buy milk,,4`)

            // scripts/run-tool.ts calls execute() without applying schema defaults.
            const result = await exportTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST } as Parameters<
                    typeof exportTemplate.execute
                >[0],
                mockTodoistApi,
            )

            expect(mockTodoistApi.exportTemplateAsFile).toHaveBeenCalled()
            expect(result.structuredContent?.format).toBe('file')
        })

        it('should ignore blank lines when counting rows', async () => {
            mockTodoistApi.exportTemplateAsFile.mockResolvedValue(
                `${CSV_HEADER}\n\ntask,Buy milk,,4\n\n`,
            )

            const result = await exportTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST, format: 'file' },
                mockTodoistApi,
            )

            expect(result.structuredContent?.lineCount).toBe(2)
        })
    })

    describe('exporting as a URL', () => {
        it('should return the shareable link without fetching the file', async () => {
            mockTodoistApi.exportTemplateAsUrl.mockResolvedValue({
                fileName: 'My Project.csv',
                fileUrl: 'https://todoist.com/templates/export/abc123.csv',
            })

            const result = await exportTemplate.execute(
                { projectId: TEST_IDS.PROJECT_TEST, format: 'url', useRelativeDates: true },
                mockTodoistApi,
            )

            expect(mockTodoistApi.exportTemplateAsUrl).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
                useRelativeDates: true,
            })
            expect(mockTodoistApi.exportTemplateAsFile).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual({
                format: 'url',
                fileName: 'My Project.csv',
                fileUrl: 'https://todoist.com/templates/export/abc123.csv',
            })
            expect(result.textContent).toContain('https://todoist.com/templates/export/abc123.csv')
        })
    })

    it('should propagate export errors', async () => {
        mockTodoistApi.exportTemplateAsFile.mockRejectedValue(
            new Error('API Error: Project not found'),
        )

        await expect(
            exportTemplate.execute({ projectId: 'non-existent', format: 'file' }, mockTodoistApi),
        ).rejects.toThrow('API Error: Project not found')
    })
})
