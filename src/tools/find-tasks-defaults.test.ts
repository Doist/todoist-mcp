import type { TodoistApi } from '@todoist/sdk'
import { z } from 'zod'
import {
    createMockApiResponse,
    createMockTask,
    createMockUser,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { findTasks } from './find-tasks.js'

describe('find-tasks without search or container filters', () => {
    it.each([
        { input: {}, query: '!assigned to: others' },
        { input: { responsibleUserFiltering: 'all' }, query: 'all' },
        { input: { responsibleUserFiltering: 'assigned' }, query: 'assigned to: others' },
        { input: { filter: '', searchText: '', labels: [] }, query: '!assigned to: others' },
    ])('lists a page for $input', async ({ input, query }) => {
        const task = createMockTask({ id: TEST_IDS.TASK_1, content: 'Review report' })
        const client = {
            getUser: vi.fn().mockResolvedValue(createMockUser()),
            getTasksByFilter: vi.fn().mockResolvedValue(createMockApiResponse([task], 'next-page')),
        } as unknown as TodoistApi
        const args = z.object(findTasks.parameters).parse({ ...input, limit: 10, cursor: 'page-2' })

        const result = await findTasks.execute(args, client)

        expect(client.getTasksByFilter).toHaveBeenCalledWith({
            query,
            limit: 10,
            cursor: 'page-2',
        })
        expect(result.structuredContent).toMatchObject({
            tasks: [{ id: TEST_IDS.TASK_1, content: 'Review report' }],
            nextCursor: 'next-page',
            totalCount: 1,
            hasMore: true,
        })
    })
})
