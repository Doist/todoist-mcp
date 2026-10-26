import type { Filter, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { filterResolver } from '../utils/filter-resolver.js'
import { createMockApiResponse, createMockFilter, createMockUser } from '../utils/test-helpers.js'
import { findFilters } from './find-filters.js'
import { findTasks } from './find-tasks.js'

function createMockClient(userId: string, filters: Filter[]): Mocked<TodoistApi> {
    return {
        sync: vi.fn().mockResolvedValue({ filters }),
        getUser: vi.fn().mockResolvedValue(createMockUser({ id: userId })),
        getTasksByFilter: vi.fn().mockResolvedValue(createMockApiResponse([])),
    } as unknown as Mocked<TodoistApi>
}

describe('find-tasks account isolation', () => {
    let clientA: Mocked<TodoistApi>
    let clientB: Mocked<TodoistApi>

    beforeEach(() => {
        filterResolver.clearCache()
        clientA = createMockClient('user-a', [
            createMockFilter({ id: '101', name: 'Focus', query: '@alpha-only' }),
            createMockFilter({ id: '102', name: 'Private Board One' }),
            createMockFilter({ id: '103', name: 'Private Board Two' }),
        ])
        clientB = createMockClient('user-b', [
            createMockFilter({ id: '201', name: 'Focus', query: '@beta-only' }),
        ])
    })

    afterEach(() => {
        filterResolver.clearCache()
    })

    it('uses listed IDs and shared names for account-specific task queries', async () => {
        await findTasks.execute({ filterIdOrName: '101', limit: 10 }, clientA)

        const listed = await findFilters.execute({}, clientB)
        const listedFilter = listed.structuredContent.filters[0]
        expect(listedFilter?.id).toBe('201')
        await findTasks.execute({ filterIdOrName: listedFilter?.id, limit: 10 }, clientB)
        await findTasks.execute({ filterIdOrName: 'Focus', limit: 10 }, clientB)
        await findTasks.execute({ filterIdOrName: 'Focus', limit: 10 }, clientA)

        expect(clientA.getTasksByFilter.mock.calls.map(([args]) => args.query)).toEqual([
            '(@alpha-only)',
            '(@alpha-only)',
        ])
        expect(clientB.getTasksByFilter.mock.calls.map(([args]) => args.query)).toEqual([
            '(@beta-only)',
            '(@beta-only)',
        ])
        expect(clientB.sync).toHaveBeenCalledTimes(2)
    })

    it('does not disclose ambiguous filter matches from another client', async () => {
        await findTasks.execute({ filterIdOrName: '101', limit: 10 }, clientA)

        await expect(
            findTasks.execute({ filterIdOrName: 'Private Board', limit: 10 }, clientB),
        ).rejects.toThrow(new Error('Filter "Private Board" not found.'))
        expect(clientB.getTasksByFilter).not.toHaveBeenCalled()
    })
})
