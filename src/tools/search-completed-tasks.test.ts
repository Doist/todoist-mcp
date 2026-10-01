import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { ApiLimits } from '../utils/constants.js'
import { createMockTask, createMockUser, TEST_IDS } from '../utils/test-helpers.js'
import { searchCompletedTasks } from './search-completed-tasks.js'

const mockTodoistApi = {
    searchCompletedTasks: vi.fn(),
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

describe('search-completed-tasks tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('requires non-empty search text', () => {
        const schema = z.object(searchCompletedTasks.parameters)

        expect(schema.safeParse({}).success).toBe(false)
        expect(schema.safeParse({ searchText: '' }).success).toBe(false)
        expect(schema.safeParse({ searchText: 'report' }).success).toBe(true)
    })

    it('searches and maps one page of completed tasks', async () => {
        mockTodoistApi.searchCompletedTasks.mockResolvedValue({
            items: [
                createMockTask({
                    id: 'completed-task-1',
                    content: 'Submit expense report',
                    checked: true,
                    completedAt: new Date('2026-08-28T18:00:00Z'),
                }),
            ],
            nextCursor: null,
        })

        const result = await searchCompletedTasks.execute(
            { searchText: 'expense report' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.searchCompletedTasks).toHaveBeenCalledWith({
            query: 'expense report',
            cursor: undefined,
            limit: ApiLimits.COMPLETED_TASKS_DEFAULT,
        })
        expect(result.structuredContent).toMatchObject({
            tasks: [
                {
                    id: 'completed-task-1',
                    content: 'Submit expense report',
                    checked: true,
                    completedAt: '2026-08-28T18:00:00.000Z',
                },
            ],
            totalCount: 1,
            hasMore: false,
            appliedFilters: {
                searchText: 'expense report',
                labelsOperator: 'or',
            },
        })
    })

    it('applies project, section, and default OR label filters to one page', async () => {
        mockTodoistApi.searchCompletedTasks.mockResolvedValue({
            items: [
                createMockTask({
                    id: 'match',
                    projectId: 'project-1',
                    sectionId: 'section-1',
                    labels: ['work'],
                }),
                createMockTask({
                    id: 'wrong-project',
                    projectId: 'project-2',
                    sectionId: 'section-1',
                    labels: ['work'],
                }),
                createMockTask({
                    id: 'wrong-section',
                    projectId: 'project-1',
                    sectionId: 'section-2',
                    labels: ['work'],
                }),
                createMockTask({
                    id: 'wrong-label',
                    projectId: 'project-1',
                    sectionId: 'section-1',
                    labels: ['personal'],
                }),
            ],
            nextCursor: 'next-page',
        })

        const result = await searchCompletedTasks.execute(
            {
                searchText: 'report',
                projectId: 'project-1',
                sectionId: 'section-1',
                labels: ['work', 'urgent'],
                cursor: 'current-page',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.searchCompletedTasks).toHaveBeenCalledWith({
            query: 'report',
            cursor: 'current-page',
            limit: ApiLimits.COMPLETED_TASKS_DEFAULT,
        })
        expect(mockTodoistApi.getUser).not.toHaveBeenCalled()
        expect(result.structuredContent).toMatchObject({
            tasks: [{ id: 'match' }],
            nextCursor: 'next-page',
            totalCount: 1,
            hasMore: true,
        })
        expect(result.textContent).toContain('client-side')
        expect(result.textContent).toContain('project: project-1')
        expect(result.textContent).toContain('section: section-1')
        expect(result.textContent).toContain('labels: @work | @urgent')
        expect(result.textContent).toContain("Pass cursor 'next-page' to fetch more results.")
    })

    it('requires every requested label with the AND operator', async () => {
        mockTodoistApi.searchCompletedTasks.mockResolvedValue({
            items: [
                createMockTask({ id: 'one-label', labels: ['work'] }),
                createMockTask({ id: 'both-labels', labels: ['work', 'urgent'] }),
            ],
            nextCursor: null,
        })

        const result = await searchCompletedTasks.execute(
            {
                searchText: 'report',
                labels: ['work', 'urgent'],
                labelsOperator: 'and',
            },
            mockTodoistApi,
        )

        expect(result.structuredContent.tasks.map((task) => task.id)).toEqual(['both-labels'])
        expect(result.structuredContent.appliedFilters).toEqual({
            searchText: 'report',
            labels: ['work', 'urgent'],
            labelsOperator: 'and',
        })
    })

    it('resolves the inbox project only when requested', async () => {
        mockTodoistApi.getUser.mockResolvedValue(
            createMockUser({ inboxProjectId: TEST_IDS.PROJECT_INBOX }),
        )
        mockTodoistApi.searchCompletedTasks.mockResolvedValue({
            items: [
                createMockTask({ id: 'inbox-task', projectId: TEST_IDS.PROJECT_INBOX }),
                createMockTask({ id: 'other-task', projectId: TEST_IDS.PROJECT_WORK }),
            ],
            nextCursor: null,
        })

        const result = await searchCompletedTasks.execute(
            { searchText: 'task', projectId: 'inbox' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(1)
        expect(result.structuredContent.tasks.map((task) => task.id)).toEqual(['inbox-task'])
        expect(result.structuredContent.appliedFilters).toMatchObject({ projectId: 'inbox' })
    })

    it('keeps pagination when client-side filters remove every task', async () => {
        mockTodoistApi.searchCompletedTasks.mockResolvedValue({
            items: [createMockTask({ projectId: 'other-project' })],
            nextCursor: 'later-page',
        })

        const result = await searchCompletedTasks.execute(
            { searchText: 'report', projectId: 'wanted-project' },
            mockTodoistApi,
        )

        expect(result.structuredContent).toMatchObject({
            tasks: [],
            nextCursor: 'later-page',
            totalCount: 0,
            hasMore: true,
        })
        expect(result.textContent).toContain('client-side')
        expect(result.textContent).toContain("Pass cursor 'later-page' to fetch more results.")
    })
})
