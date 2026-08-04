import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { completeTasks } from './complete-tasks.js'

// Mock the Todoist API
const mockTodoistApi = {
    closeTask: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { COMPLETE_TASKS } = ToolNames

describe(`${COMPLETE_TASKS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('completing multiple tasks', () => {
        it('should complete all tasks successfully', async () => {
            mockTodoistApi.closeTask.mockResolvedValue(true)

            const result = await completeTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3'] },
                mockTodoistApi,
            )

            // Verify API was called for each task
            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.closeTask).toHaveBeenNthCalledWith(1, 'task-1')
            expect(mockTodoistApi.closeTask).toHaveBeenNthCalledWith(2, 'task-2')
            expect(mockTodoistApi.closeTask).toHaveBeenNthCalledWith(3, 'task-3')

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const { structuredContent } = result
            expect(structuredContent).toEqual({
                completed: ['task-1', 'task-2', 'task-3'],
                failures: [], // failures array is now kept as empty array
                totalRequested: 3,
                successCount: 3,
                failureCount: 0,
            })
        })

        it('should complete single task', async () => {
            mockTodoistApi.closeTask.mockResolvedValue(true)

            const result = await completeTasks.execute({ ids: ['8485093748'] }, mockTodoistApi)

            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.closeTask).toHaveBeenCalledWith('8485093748')

            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const { structuredContent } = result
            expect(structuredContent).toEqual({
                completed: ['8485093748'],
                failures: [], // failures array is now kept as empty array
                totalRequested: 1,
                successCount: 1,
                failureCount: 0,
            })
        })

        it('should handle partial failures gracefully', async () => {
            // Mock first and third tasks to succeed, second to fail
            mockTodoistApi.closeTask
                .mockResolvedValueOnce(true) // task-1 succeeds
                .mockRejectedValueOnce(new Error('Task not found')) // task-2 fails
                .mockResolvedValueOnce(true) // task-3 succeeds

            const result = await completeTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3'] },
                mockTodoistApi,
            )

            // Verify API was called for all tasks despite failure
            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.closeTask).toHaveBeenNthCalledWith(1, 'task-1')
            expect(mockTodoistApi.closeTask).toHaveBeenNthCalledWith(2, 'task-2')
            expect(mockTodoistApi.closeTask).toHaveBeenNthCalledWith(3, 'task-3')

            // Verify only successful completions are reported
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content with partial failures
            const { structuredContent } = result
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    completed: ['task-1', 'task-3'],
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
            mockTodoistApi.closeTask.mockRejectedValue(apiError)

            const result = await completeTasks.execute(
                { ids: ['task-1', 'task-2'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(2)
            expect(result.textContent).toMatchSnapshot()
        })

        it('should continue processing remaining tasks after failures', async () => {
            // Mock various failure scenarios
            mockTodoistApi.closeTask
                .mockRejectedValueOnce(new Error('Task already completed'))
                .mockRejectedValueOnce(new Error('Task not found'))
                .mockResolvedValueOnce(true) // task-3 succeeds
                .mockRejectedValueOnce(new Error('Permission denied'))
                .mockResolvedValueOnce(true) // task-5 succeeds

            const result = await completeTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(5)

            // Only tasks 3 and 5 should be in completed list
            expect(result.textContent).toMatchSnapshot()
        })

        it('should handle different types of API errors', async () => {
            mockTodoistApi.closeTask
                .mockRejectedValueOnce(new Error('Task not found'))
                .mockRejectedValueOnce(new Error('Task already completed'))
                .mockRejectedValueOnce(new Error('Permission denied'))
                .mockRejectedValueOnce(new Error('Rate limit exceeded'))

            const result = await completeTasks.execute(
                { ids: ['not-found', 'already-done', 'no-permission', 'rate-limited'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(4)

            // All should fail, but the tool should handle it gracefully
            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('mixed success and failure scenarios', () => {
        it('should handle realistic mixed scenario', async () => {
            // Simulate a realistic scenario with some tasks completing and others failing
            mockTodoistApi.closeTask
                .mockResolvedValueOnce(true) // regular task completion
                .mockResolvedValueOnce(true) // another successful completion
                .mockRejectedValueOnce(new Error('Task already completed')) // duplicate completion
                .mockResolvedValueOnce(true) // successful completion
                .mockRejectedValueOnce(new Error('Task not found')) // deleted task

            const result = await completeTasks.execute(
                {
                    ids: [
                        '8485093748', // regular task
                        '8485093749', // regular task
                        '8485093750', // already completed
                        '8485093751', // regular task
                        '8485093752', // deleted task
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(5)

            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('next steps logic validation', () => {
        it('should suggest overdue tasks when all tasks complete successfully', async () => {
            mockTodoistApi.closeTask.mockResolvedValue(true)

            const result = await completeTasks.execute(
                { ids: ['task-1', 'task-2'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
        })

        it('should suggest reviewing failures when mixed results', async () => {
            mockTodoistApi.closeTask
                .mockResolvedValueOnce(true)
                .mockRejectedValueOnce(new Error('Task not found'))

            const result = await completeTasks.execute(
                { ids: ['task-1', 'task-2'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
        })

        it('should suggest checking IDs when all tasks fail', async () => {
            mockTodoistApi.closeTask.mockRejectedValue(new Error('Task not found'))

            const result = await completeTasks.execute(
                { ids: ['bad-id-1', 'bad-id-2'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
        })
    })

    describe('error message truncation', () => {
        it('should truncate failure messages after 3 errors', async () => {
            mockTodoistApi.closeTask
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'))
                .mockRejectedValueOnce(new Error('Error 4'))
                .mockRejectedValueOnce(new Error('Error 5'))

            const result = await completeTasks.execute(
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
            mockTodoistApi.closeTask
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockRejectedValueOnce(new Error('Error 2'))
                .mockRejectedValueOnce(new Error('Error 3'))

            const result = await completeTasks.execute(
                { ids: ['task-1', 'task-2', 'task-3'] },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).not.toContain('more') // Should not show truncation
        })
    })

    describe('edge cases', () => {
        it('should handle empty task completion (minimum one task required by schema)', async () => {
            // Note: This test documents that the schema requires at least one task,
            // so this scenario shouldn't occur in practice due to validation
            mockTodoistApi.closeTask.mockResolvedValue(true)

            const result = await completeTasks.execute({ ids: ['single-task'] }, mockTodoistApi)

            expect(result.textContent).toMatchSnapshot()
        })

        it('should handle tasks with special ID formats', async () => {
            mockTodoistApi.closeTask.mockResolvedValue(true)

            const result = await completeTasks.execute(
                { ids: ['proj_123_task_456', 'task-with-dashes', '1234567890'] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.closeTask).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.closeTask).toHaveBeenCalledWith('proj_123_task_456')
            expect(mockTodoistApi.closeTask).toHaveBeenCalledWith('task-with-dashes')
            expect(mockTodoistApi.closeTask).toHaveBeenCalledWith('1234567890')

            expect(result.textContent).toMatchSnapshot()
        })
    })
})
