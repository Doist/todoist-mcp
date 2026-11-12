import type { TodoistApi } from '@todoist/sdk'
import { z } from 'zod'
import { createMockApiResponse, createMockTask, TEST_IDS } from '../utils/test-helpers.js'
import { findTasksByDate } from './find-tasks-by-date.js'

describe('find-tasks-by-date without a start date', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 10, 29, 12))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it.each([
        { overdueOption: undefined, query: '(today | overdue) & !assigned to: others' },
        { overdueOption: 'exclude-overdue', query: 'today & !assigned to: others' },
        {
            overdueOption: undefined,
            daysCount: 3,
            query: '((due after: 2026-11-29 | due: 2026-11-29) & due before: 2026-12-02 | overdue) & !assigned to: others',
        },
    ])(
        'uses today with overdueOption=$overdueOption and daysCount=$daysCount',
        async ({ overdueOption, daysCount, query }) => {
            const client = {
                getTasksByFilter: vi
                    .fn()
                    .mockResolvedValue(
                        createMockApiResponse([createMockTask({ id: TEST_IDS.TASK_1 })]),
                    ),
            } as unknown as TodoistApi
            const args = z.object(findTasksByDate.parameters).parse({ overdueOption, daysCount })

            const result = await findTasksByDate.execute(args, client)

            expect(client.getTasksByFilter).toHaveBeenCalledWith({
                query,
                limit: 10,
                cursor: undefined,
            })
            expect(result.structuredContent).toMatchObject({
                tasks: [{ id: TEST_IDS.TASK_1 }],
                totalCount: 1,
                hasMore: false,
                appliedFilters: { startDate: 'today', daysCount: daysCount ?? 1, limit: 10 },
            })
            expect(result.textContent).toContain('today')
        },
    )
})
