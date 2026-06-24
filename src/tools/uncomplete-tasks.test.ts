import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { uncompleteTasks } from './uncomplete-tasks.js'

// Mock the Todoist API
const mockTodoistApi = {
    reopenTask: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UNCOMPLETE_TASKS } = ToolNames

describe(`${UNCOMPLETE_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('uncompleting multiple tasks', () => {
        it('should uncomplete all tasks successfully', async () => {
            mockTodoistApi.reopenTask.mockResolvedValue(true)

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3'] },
                mockTodoistApi,
            )

            // Verify API was called for each task
            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.reopenTask).toHaveBeenNthCalledWith(1, 'task-1')
            expect(mockTodoistApi.reopenTask).toHaveBeenNthCalledWith(2, 'task-2')
            expect(mockTodoistApi.reopenTask).toHaveBeenNthCalledWith(3, 'task-3')

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const { structuredContent } = result
            expect(structuredContent).toEqual({
                uncompleted: ['task-1', 'task-2', 'task-3'],
                failures: [],
                totalRequested: 3,
                successCount: 3,
                failureCount: 0,
            })
        })

        it('should uncomplete single task', async () => {
            mockTodoistApi.reopenTask.mockResolvedValue(true)

            const result = await uncompleteTasks.execute({ ids: ['8485093748'] }, mockTodoistApi)

            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.reopenTask).toHaveBeenCalledWith('8485093748')

            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const { structuredContent } = result
            expect(structuredContent).toEqual({
                uncompleted: ['8485093748'],
                failures: [],
                totalRequested: 1,
                successCount: 1,
                failureCount: 0,
            })
        })

        it('should handle partial failures gracefully', async () => {
            // Mock first and third tasks to succeed, second to fail
            mockTodoistApi.reopenTask
                .mockResolvedValueOnce(true) // task-1 succeeds
                .mockRejectedValueOnce(new Error('Task not found')) // task-2 fails
                .mockResolvedValueOnce(true) // task-3 succeeds

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3'] },
                mockTodoistApi,
            )

            // Verify API was called for all tasks despite failure
            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.reopenTask).toHaveBeenNthCalledWith(1, 'task-1')
            expect(mockTodoistApi.reopenTask).toHaveBeenNthCalledWith(2, 'task-2')
            expect(mockTodoistApi.reopenTask).toHaveBeenNthCalledWith(3, 'task-3')

            // Verify only successful uncompletions are reported
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content with partial failures
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    uncompleted: ['task-1', 'task-3'],
                    failures: [
                        expect.objectContaining({
                            item: 'task-2',
                            error: 'Task not found',
                        }),
                    ],
                    totalRequested: 3,
                    successCount: 2,
                    failureCount: 1,
                }),
            )
        })

        it('should handle all tasks failing', async () => {
            const apiError = new Error('API Error: Network timeout')
            mockTodoistApi.reopenTask.mockRejectedValue(apiError)

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(2)
            expect(result.textContent).toMatchSnapshot()
        })

        it('should continue processing remaining tasks after failures', async () => {
            // Mock various failure scenarios
            mockTodoistApi.reopenTask
                .mockRejectedValueOnce(new Error('Task already active'))
                .mockRejectedValueOnce(new Error('Task not found'))
                .mockResolvedValueOnce(true) // task-3 succeeds
                .mockRejectedValueOnce(new Error('Permission denied'))
                .mockResolvedValueOnce(true) // task-5 succeeds

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(5)

            // Only tasks 3 and 5 should be in uncompleted list
            expect(result.textContent).toMatchSnapshot()
        })

        it('should handle different types of API errors', async () => {
            mockTodoistApi.reopenTask
                .mockRejectedValueOnce(new Error('Task not found'))
                .mockRejectedValueOnce(new Error('Task already active'))
                .mockRejectedValueOnce(new Error('Permission denied'))
                .mockRejectedValueOnce(new Error('Rate limit exceeded'))

            const result = await uncompleteTasks.execute(
                { ids: ['not-found', 'already-active', 'no-permission', 'rate-limited'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(4)

            // All should fail, but the tool should handle it gracefully
            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('mixed success and failure scenarios', () => {
        it('should handle realistic mixed scenario', async () => {
            // Simulate a realistic scenario with some tasks reopening and others failing
            mockTodoistApi.reopenTask
                .mockResolvedValueOnce(true) // regular task reopen
                .mockResolvedValueOnce(true) // another successful reopen
                .mockRejectedValueOnce(new Error('Task already active')) // duplicate reopen
                .mockResolvedValueOnce(true) // successful reopen
                .mockRejectedValueOnce(new Error('Task not found')) // deleted task

            const result = await uncompleteTasks.execute(
                {
                    ids: [
                        '8485093748', // regular task
                        '8485093749', // regular task
                        '8485093750', // already active
                        '8485093751', // regular task
                        '8485093752', // deleted task
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(5)

            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('next steps logic validation', () => {
        it('should suggest next steps when all tasks uncomplete successfully', async () => {
            mockTodoistApi.reopenTask.mockResolvedValue(true)

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
        })

        it('should suggest reviewing failures when mixed results', async () => {
            mockTodoistApi.reopenTask
                .mockResolvedValueOnce(true)
                .mockRejectedValueOnce(new Error('Task not found'))

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
        })

        it('should suggest checking IDs when all tasks fail', async () => {
            mockTodoistApi.reopenTask.mockRejectedValue(new Error('Task not found'))

            const result = await uncompleteTasks.execute(
                { ids: ['bad-id-1', 'bad-id-2'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
        })
    })

    describe('error message truncation', () => {
        it('should truncate failure messages after 3 errors', async () => {
            mockTodoistApi.reopenTask
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'))
                .mockRejectedValueOnce(new Error('Error 4'))
                .mockRejectedValueOnce(new Error('Error 5'))

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('+2 more') // 5 total failures, showing first 3, so +2 more
            expect(textContent).not.toContain('Error 4') // Should not show 4th error
            expect(textContent).not.toContain('Error 5') // Should not show 5th error
        })

        it('should not show truncation message for exactly 3 errors', async () => {
            mockTodoistApi.reopenTask
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'))

            const result = await uncompleteTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).not.toContain('more') // Should not show truncation
        })
    })

    describe('edge cases', () => {
        it('should handle minimum one task required by schema', async () => {
            mockTodoistApi.reopenTask.mockResolvedValue(true)

            const result = await uncompleteTasks.execute({ ids: ['single-task'] }, mockTodoistApi)

            expect(result.textContent).toMatchSnapshot()
        })

        it('should handle tasks with special ID formats', async () => {
            mockTodoistApi.reopenTask.mockResolvedValue(true)

            const result = await uncompleteTasks.execute(
                { ids: ['proj_123_task_456', 'task-with-dashes', '1234567890'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.reopenTask).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.reopenTask).toHaveBeenCalledWith('proj_123_task_456')
            expect(mockTodoistApi.reopenTask).toHaveBeenCalledWith('task-with-dashes')
            expect(mockTodoistApi.reopenTask).toHaveBeenCalledWith('1234567890')

            expect(result.textContent).toMatchSnapshot()
        })
    })
})
