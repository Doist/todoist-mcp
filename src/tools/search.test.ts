import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, type MockedFunction, vi } from 'vitest'
import { getTasksByFilter } from '../tool-helpers.js'
import {
    createMappedTask,
    createMockApiResponse,
    createMockProject,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { search } from './search.js'

vi.mock('../tool-helpers', async () => {
    const actual = (await vi.importActual('../tool-helpers')) as typeof import('../tool-helpers.js')
    return {
        ...actual,
        getTasksByFilter: vi.fn(),
    }
})

const { SEARCH } = ToolNames

const mockGetTasksByFilter = getTasksByFilter as MockedFunction<typeof getTasksByFilter>

// Mock the Todoist API
const mockTodoistApi = {
    searchProjects: vi.fn(),
} as unknown as Mocked<TodoistApi>

describe(`${SEARCH} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('searching tasks and projects', () => {
        it('should search both tasks and projects and return combined results', async () => {
            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'Important meeting task',
                }),
                createMappedTask({
                    id: TEST_IDS.TASK_2,
                    content: 'Another important item',
                }),
            ]
            const mockProjects = [
                createMockProject({
                    id: TEST_IDS.PROJECT_WORK,
                    name: 'Important Work Project',
                }),
            ]

            mockGetTasksByFilter.mockResolvedValue({ tasks: mockTasks, nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse(mockProjects))

            const result = await search.execute({ query: 'important' }, mockTodoistApi)

            // Verify both API calls were made
            expect(mockGetTasksByFilter).toHaveBeenCalledWith({
                client: mockTodoistApi,
                query: 'search: important',
                limit: 100, // TASKS_MAX
                cursor: undefined,
            })
            expect(mockTodoistApi.searchProjects).toHaveBeenCalledWith({
                query: '*important*',
                limit: 200, // PROJECTS_MAX
                cursor: null,
            })

            // Parse the JSON response
            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse).toHaveProperty('results')
            expect(jsonResponse.results).toHaveLength(3) // 2 tasks + 1 project matching "important"

            // Verify task results
            expect(jsonResponse.results[0]).toEqual({
                id: `task:${TEST_IDS.TASK_1}`,
                title: 'Important meeting task',
                url: `https://app.todoist.com/app/task/${TEST_IDS.TASK_1}`,
            })
            expect(jsonResponse.results[1]).toEqual({
                id: `task:${TEST_IDS.TASK_2}`,
                title: 'Another important item',
                url: `https://app.todoist.com/app/task/${TEST_IDS.TASK_2}`,
            })

            // Verify project result (only "Important Work Project" matches)
            expect(jsonResponse.results[2]).toEqual({
                id: `project:${TEST_IDS.PROJECT_WORK}`,
                title: 'Important Work Project',
                url: `https://app.todoist.com/app/project/${TEST_IDS.PROJECT_WORK}`,
            })
        })

        it('should return only matching tasks when no projects match', async () => {
            const mockTasks = [
                createMappedTask({
                    id: TEST_IDS.TASK_1,
                    content: 'Unique task content',
                }),
            ]
            mockGetTasksByFilter.mockResolvedValue({ tasks: mockTasks, nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))

            const result = await search.execute({ query: 'unique' }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.results).toHaveLength(1)
            expect(jsonResponse.results[0].id).toBe(`task:${TEST_IDS.TASK_1}`)
        })

        it('should return only matching projects when no tasks match', async () => {
            const mockProjects = [
                createMockProject({
                    id: TEST_IDS.PROJECT_WORK,
                    name: 'Special Project Name',
                }),
            ]

            mockGetTasksByFilter.mockResolvedValue({ tasks: [], nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse(mockProjects))

            const result = await search.execute({ query: 'special' }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.results).toHaveLength(1)
            expect(jsonResponse.results[0]).toEqual({
                id: `project:${TEST_IDS.PROJECT_WORK}`,
                title: 'Special Project Name',
                url: `https://app.todoist.com/app/project/${TEST_IDS.PROJECT_WORK}`,
            })
        })

        it('should return empty results when nothing matches', async () => {
            mockGetTasksByFilter.mockResolvedValue({ tasks: [], nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))

            const result = await search.execute({ query: 'nonexistent' }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.results).toHaveLength(0)
        })

        it('should perform case-insensitive project filtering', async () => {
            const mockProjects = [
                createMockProject({
                    id: TEST_IDS.PROJECT_WORK,
                    name: 'Important Work',
                }),
            ]

            mockGetTasksByFilter.mockResolvedValue({ tasks: [], nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse(mockProjects))

            const result = await search.execute({ query: 'IMPORTANT' }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.results).toHaveLength(1)
            expect(jsonResponse.results[0].title).toBe('Important Work')
        })

        it('should handle partial matches in project names', async () => {
            const mockProjects = [
                createMockProject({ id: 'project-1', name: 'Development Tasks' }),
                createMockProject({ id: 'project-2', name: 'Developer Resources' }),
            ]

            mockGetTasksByFilter.mockResolvedValue({ tasks: [], nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse(mockProjects))

            const result = await search.execute({ query: 'develop' }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.results).toHaveLength(2)
            expect(jsonResponse.results[0].title).toBe('Development Tasks')
            expect(jsonResponse.results[1].title).toBe('Developer Resources')
        })
    })

    describe('error handling', () => {
        it('should throw error for task search failure', async () => {
            mockGetTasksByFilter.mockRejectedValue(new Error('Task search failed'))
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))

            await expect(search.execute({ query: 'test' }, mockTodoistApi)).rejects.toThrow(
                'Task search failed',
            )
        })

        it('should throw error for project search failure', async () => {
            mockGetTasksByFilter.mockResolvedValue({ tasks: [], nextCursor: null })
            mockTodoistApi.searchProjects.mockRejectedValue(new Error('Project search failed'))

            await expect(search.execute({ query: 'test' }, mockTodoistApi)).rejects.toThrow(
                'Project search failed',
            )
        })
    })

    describe('OpenAI MCP spec compliance', () => {
        it('should return valid JSON string in text field', async () => {
            mockGetTasksByFilter.mockResolvedValue({ tasks: [], nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))

            const result = await search.execute({ query: 'test' }, mockTodoistApi)
            expect(() => JSON.parse(result.textContent ?? '{}')).not.toThrow()
        })

        it('should include required fields (id, title, url) in each result', async () => {
            const mockTasks = [createMappedTask({ id: TEST_IDS.TASK_1, content: 'Test' })]
            const mockProjects = [createMockProject({ id: TEST_IDS.PROJECT_WORK, name: 'Test' })]

            mockGetTasksByFilter.mockResolvedValue({ tasks: mockTasks, nextCursor: null })
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse(mockProjects))

            const result = await search.execute({ query: 'test' }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            for (const item of jsonResponse.results) {
                expect(item).toHaveProperty('id')
                expect(item).toHaveProperty('title')
                expect(item).toHaveProperty('url')
                expect(typeof item.id).toBe('string')
                expect(typeof item.title).toBe('string')
                expect(typeof item.url).toBe('string')
            }
        })
    })
})
