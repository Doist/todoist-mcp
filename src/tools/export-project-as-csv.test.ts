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

    it('returns the CSV content and row count', async () => {
        const csv = `${CSV_HEADER}\ntask,Buy milk,,4`
        mockTodoistApi.exportProjectAsCSV.mockResolvedValue(csv)

        const result = await exportProjectAsCSV.execute(
            { projectId: TEST_IDS.PROJECT_TEST, useRelativeDates: true },
            mockTodoistApi,
        )

        expect(mockTodoistApi.exportProjectAsCSV).toHaveBeenCalledWith({
            projectId: TEST_IDS.PROJECT_TEST,
            useRelativeDates: true,
        })
        expect(result.structuredContent).toEqual({ content: csv, lineCount: 2 })
        expect(result.textContent).toBe(
            `Exported project (id=${TEST_IDS.PROJECT_TEST}) as CSV (2 rows).\n\n${csv}`,
        )
    })

    it('never creates a shareable link', async () => {
        mockTodoistApi.exportProjectAsCSV.mockResolvedValue(`${CSV_HEADER}\ntask,Buy milk,,4`)

        // A caller still sending the old tool's `format: "url"` gets the CSV, not a public link.
        await exportProjectAsCSV.execute(
            { projectId: TEST_IDS.PROJECT_TEST, format: 'url' } as Parameters<
                typeof exportProjectAsCSV.execute
            >[0],
            mockTodoistApi,
        )

        expect(mockTodoistApi.exportTemplateAsUrl).not.toHaveBeenCalled()
        expect(mockTodoistApi.exportProjectAsCSV).toHaveBeenCalledTimes(1)
    })

    it('previews only the first rows of a long export', async () => {
        const rows = Array.from({ length: 12 }, (_, index) => `task,Task ${index + 1},,4`)
        mockTodoistApi.exportProjectAsCSV.mockResolvedValue([CSV_HEADER, ...rows].join('\n'))

        const result = await exportProjectAsCSV.execute(
            { projectId: TEST_IDS.PROJECT_TEST },
            mockTodoistApi,
        )

        expect(result.structuredContent?.lineCount).toBe(13)
        // Preview stops at 5 rows so a large project is not spelled out twice.
        expect(result.textContent).toContain('Task 4')
        expect(result.textContent).not.toContain('Task 12')
        expect(result.textContent).toContain('8 more rows')
    })

    it('ignores blank lines when counting rows', async () => {
        mockTodoistApi.exportProjectAsCSV.mockResolvedValue(`${CSV_HEADER}\n\ntask,Buy milk,,4\n\n`)

        const result = await exportProjectAsCSV.execute(
            { projectId: TEST_IDS.PROJECT_TEST },
            mockTodoistApi,
        )

        expect(result.structuredContent?.lineCount).toBe(2)
    })

    it('propagates export errors', async () => {
        mockTodoistApi.exportProjectAsCSV.mockRejectedValue(
            new Error('API Error: Project not found'),
        )

        await expect(
            exportProjectAsCSV.execute({ projectId: 'non-existent' }, mockTodoistApi),
        ).rejects.toThrow('API Error: Project not found')
    })
})
