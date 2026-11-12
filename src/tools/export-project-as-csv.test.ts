import type { TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { exportProjectAsCSV } from './export-project-as-csv.js'

const mockTodoistApi = {
    exportProjectAsCSV: vi.fn(),
    exportTemplateAsUrl: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { EXPORT_PROJECT_AS_CSV } = ToolNames

const CSV_HEADER = 'TYPE,CONTENT,DESCRIPTION,PRIORITY'

describe(`${EXPORT_PROJECT_AS_CSV} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('exporting as a file', () => {
        it('should return the CSV content and row count', async () => {
            const csv = `${CSV_HEADER}\ntask,Buy milk,,4`
            mockTodoistApi.exportProjectAsCSV.mockResolvedValue(csv)

            const result = await exportProjectAsCSV.execute(
                { projectId: TEST_IDS.PROJECT_TEST, format: 'file' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.exportProjectAsCSV).toHaveBeenCalledWith({
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
            mockTodoistApi.exportProjectAsCSV.mockResolvedValue([CSV_HEADER, ...rows].join('\n'))

            const result = await exportProjectAsCSV.execute(
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
            mockTodoistApi.exportProjectAsCSV.mockResolvedValue(`${CSV_HEADER}\ntask,Buy milk,,4`)

            // scripts/run-tool.ts calls execute() without applying schema defaults.
            const result = await exportProjectAsCSV.execute(
                { projectId: TEST_IDS.PROJECT_TEST } as Parameters<
                    typeof exportProjectAsCSV.execute
                >[0],
                mockTodoistApi,
            )

            expect(mockTodoistApi.exportProjectAsCSV).toHaveBeenCalled()
            expect(result.structuredContent?.format).toBe('file')
        })

        it('should ignore blank lines when counting rows', async () => {
            mockTodoistApi.exportProjectAsCSV.mockResolvedValue(
                `${CSV_HEADER}\n\ntask,Buy milk,,4\n\n`,
            )

            const result = await exportProjectAsCSV.execute(
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

            const result = await exportProjectAsCSV.execute(
                { projectId: TEST_IDS.PROJECT_TEST, format: 'url', useRelativeDates: true },
                mockTodoistApi,
            )

            expect(mockTodoistApi.exportTemplateAsUrl).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
                useRelativeDates: true,
            })
            expect(mockTodoistApi.exportProjectAsCSV).not.toHaveBeenCalled()
            expect(result.structuredContent).toEqual({
                format: 'url',
                fileName: 'My Project.csv',
                fileUrl: 'https://todoist.com/templates/export/abc123.csv',
            })
            expect(result.textContent).toBe(
                `Exported project (id=${TEST_IDS.PROJECT_TEST}) as a public CSV link: My Project.csv\nhttps://todoist.com/templates/export/abc123.csv\nAnyone holding the link can open it, and it cannot be revoked.`,
            )
        })
    })

    it('should propagate export errors', async () => {
        mockTodoistApi.exportProjectAsCSV.mockRejectedValue(
            new Error('API Error: Project not found'),
        )

        await expect(
            exportProjectAsCSV.execute(
                { projectId: 'non-existent', format: 'file' },
                mockTodoistApi,
            ),
        ).rejects.toThrow('API Error: Project not found')
    })
})
