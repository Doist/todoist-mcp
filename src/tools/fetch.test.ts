import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockProject, createMockTask, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { fetch } from './fetch.js'

// Mock the Todoist API
const mockTodoistApi = {
    getTask: vi.fn(),
    getProject: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FETCH } = ToolNames

describe(`${FETCH} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('fetching tasks', () => {
        it('should fetch a task by composite ID and return full content', async () => {
            const mockTask = createMockTask({
                id: TEST_IDS.TASK_1,
                content: 'Important meeting with team',
                description: 'Discuss project roadmap and timeline',
                labels: ['work', 'urgent'],
                priority: 'p3',
                projectId: TEST_IDS.PROJECT_WORK,
                sectionId: TEST_IDS.SECTION_1,
                due: {
                    date: '2025-10-15',
                    isRecurring: false,
                    datetime: null,
                    string: '2025-10-15',
                    timezone: null,
                    lang: 'en',
                },
            })

            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_1}` }, mockTodoistApi)

            // Verify API was called correctly
            expect(mockTodoistApi.getTask).toHaveBeenCalledWith(TEST_IDS.TASK_1)

            // Parse the JSON response
            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse).toEqual({
                id: `task:${TEST_IDS.TASK_1}`,
                title: 'Important meeting with team',
                text: 'Important meeting with team\n\nDescription: Discuss project roadmap and timeline\nDue: 2025-10-15\nLabels: work, urgent',
                url: `https://app.todoist.com/app/task/${TEST_IDS.TASK_1}`,
                metadata: {
                    priority: 'p3',
                    projectId: TEST_IDS.PROJECT_WORK,
                    sectionId: TEST_IDS.SECTION_1,
                    recurring: false,
                    checked: false,
                },
            })
        })

        it('should fetch a task without optional fields', async () => {
            const mockTask = createMockTask({
                id: TEST_IDS.TASK_2,
                content: 'Simple task',
                description: '',
                labels: [],
                due: null,
            })

            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_2}` }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.title).toBe('Simple task')
            expect(jsonResponse.text).toBe('Simple task')
            expect(jsonResponse.metadata).toEqual({
                priority: 'p4',
                projectId: TEST_IDS.PROJECT_TEST,
                recurring: false,
                checked: false,
            })
        })

        it('should handle tasks with recurring due dates', async () => {
            const mockTask = createMockTask({
                id: TEST_IDS.TASK_3,
                content: 'Weekly meeting',
                due: {
                    date: '2025-10-15',
                    isRecurring: true,
                    datetime: null,
                    string: 'every monday',
                    timezone: null,
                    lang: 'en',
                },
            })

            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_3}` }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.metadata.recurring).toBe('every monday')
        })

        it('should handle tasks with duration', async () => {
            const mockTask = createMockTask({
                id: TEST_IDS.TASK_1,
                content: 'Task with duration',
                duration: {
                    amount: 90,
                    unit: 'minute',
                },
            })

            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_1}` }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.metadata.duration).toBe('1h30m')
        })

        it('should handle tasks with assignments', async () => {
            const mockTask = createMockTask({
                id: TEST_IDS.TASK_1,
                content: 'Assigned task',
                responsibleUid: 'user-123',
                assignedByUid: 'user-456',
            })

            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_1}` }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.metadata.responsibleUid).toBe('user-123')
            expect(jsonResponse.metadata.assignedByUid).toBe('user-456')
        })
    })

    describe('fetching projects', () => {
        it('should fetch a project by composite ID and return full content', async () => {
            const mockProject = createMockProject({
                id: TEST_IDS.PROJECT_WORK,
                name: 'Work Project',
                color: 'blue',
                isFavorite: true,
                isShared: true,
                viewStyle: 'board',
                parentId: null,
                inboxProject: false,
            })

            mockTodoistApi.getProject.mockResolvedValue(mockProject)

            const result = await fetch.execute(
                { id: `project:${TEST_IDS.PROJECT_WORK}` },
                mockTodoistApi,
            )

            // Verify API was called correctly
            expect(mockTodoistApi.getProject).toHaveBeenCalledWith(TEST_IDS.PROJECT_WORK)

            // Parse the JSON response
            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse).toEqual({
                id: `project:${TEST_IDS.PROJECT_WORK}`,
                title: 'Work Project',
                text: 'Work Project\n\nShared project\nFavorite: Yes',
                url: `https://app.todoist.com/app/project/${TEST_IDS.PROJECT_WORK}`,
                metadata: {
                    color: 'blue',
                    isFavorite: true,
                    isShared: true,
                    inboxProject: false,
                    viewStyle: 'board',
                },
            })
        })

        it('surfaces the project description in the fetched text', async () => {
            const mockProject = createMockProject({
                id: TEST_IDS.PROJECT_WORK,
                name: 'Work Project',
                description: 'Quarterly OKRs',
            })
            mockTodoistApi.getProject.mockResolvedValue(mockProject)

            const result = await fetch.execute(
                { id: `project:${TEST_IDS.PROJECT_WORK}` },
                mockTodoistApi,
            )

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.text).toContain('Description: Quarterly OKRs')
        })

        it('should fetch a project without optional flags', async () => {
            const mockProject = createMockProject({
                id: TEST_IDS.PROJECT_TEST,
                name: 'Simple Project',
                isFavorite: false,
                isShared: false,
            })

            mockTodoistApi.getProject.mockResolvedValue(mockProject)

            const result = await fetch.execute(
                { id: `project:${TEST_IDS.PROJECT_TEST}` },
                mockTodoistApi,
            )

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.title).toBe('Simple Project')
            expect(jsonResponse.text).toBe('Simple Project')
            expect(jsonResponse.metadata.isFavorite).toBe(false)
            expect(jsonResponse.metadata.isShared).toBe(false)
        })

        it('should fetch inbox project', async () => {
            const mockProject = createMockProject({
                id: TEST_IDS.PROJECT_INBOX,
                name: 'Inbox',
                inboxProject: true,
            })

            mockTodoistApi.getProject.mockResolvedValue(mockProject)

            const result = await fetch.execute(
                { id: `project:${TEST_IDS.PROJECT_INBOX}` },
                mockTodoistApi,
            )

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.metadata.inboxProject).toBe(true)
        })

        it('should fetch project with parent ID', async () => {
            const mockProject = createMockProject({
                id: 'sub-project-id',
                name: 'Sub Project',
                parentId: TEST_IDS.PROJECT_WORK,
            })

            mockTodoistApi.getProject.mockResolvedValue(mockProject)

            const result = await fetch.execute({ id: 'project:sub-project-id' }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse.metadata.parentId).toBe(TEST_IDS.PROJECT_WORK)
        })
    })

    describe('error handling', () => {
        it('should throw error for invalid ID format (missing colon)', async () => {
            await expect(fetch.execute({ id: 'invalid-id' }, mockTodoistApi)).rejects.toThrow(
                'Invalid ID format',
            )
        })

        it('should throw error for invalid ID format (missing type)', async () => {
            await expect(fetch.execute({ id: ':8485093748' }, mockTodoistApi)).rejects.toThrow(
                'Invalid ID format',
            )
        })

        it('should throw error for invalid ID format (missing object ID)', async () => {
            await expect(fetch.execute({ id: 'task:' }, mockTodoistApi)).rejects.toThrow(
                'Invalid ID format',
            )
        })

        it('should throw error for invalid type', async () => {
            await expect(fetch.execute({ id: 'section:123' }, mockTodoistApi)).rejects.toThrow(
                'Invalid ID format',
            )
        })

        it('should throw error for task fetch failure', async () => {
            mockTodoistApi.getTask.mockRejectedValue(new Error('Task not found'))

            await expect(
                fetch.execute({ id: `task:${TEST_IDS.TASK_1}` }, mockTodoistApi),
            ).rejects.toThrow('Task not found')
        })

        it('should throw error for project fetch failure', async () => {
            mockTodoistApi.getProject.mockRejectedValue(new Error('Project not found'))

            await expect(
                fetch.execute({ id: `project:${TEST_IDS.PROJECT_WORK}` }, mockTodoistApi),
            ).rejects.toThrow('Project not found')
        })
    })

    describe('OpenAI MCP spec compliance', () => {
        it('should return valid JSON string in text field', async () => {
            const mockTask = createMockTask({ id: TEST_IDS.TASK_1, content: 'Test' })
            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_1}` }, mockTodoistApi)

            expect(() => JSON.parse(result.textContent ?? '{}')).not.toThrow()
        })

        it('should include all required fields (id, title, text, url)', async () => {
            const mockTask = createMockTask({ id: TEST_IDS.TASK_1, content: 'Test' })
            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_1}` }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse).toHaveProperty('id')
            expect(jsonResponse).toHaveProperty('title')
            expect(jsonResponse).toHaveProperty('text')
            expect(jsonResponse).toHaveProperty('url')
            expect(typeof jsonResponse.id).toBe('string')
            expect(typeof jsonResponse.title).toBe('string')
            expect(typeof jsonResponse.text).toBe('string')
            expect(typeof jsonResponse.url).toBe('string')
        })

        it('should include optional metadata field', async () => {
            const mockTask = createMockTask({ id: TEST_IDS.TASK_1, content: 'Test' })
            mockTodoistApi.getTask.mockResolvedValue(mockTask)

            const result = await fetch.execute({ id: `task:${TEST_IDS.TASK_1}` }, mockTodoistApi)

            const jsonResponse = JSON.parse(result.textContent ?? '{}')
            expect(jsonResponse).toHaveProperty('metadata')
            expect(typeof jsonResponse.metadata).toBe('object')
        })
    })
})
