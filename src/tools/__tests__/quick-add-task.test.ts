import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockTask } from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { quickAddTask } from '../quick-add-task.js'

const mockTodoistApi = {
    quickAddTask: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { QUICK_ADD_TASK } = ToolNames

describe(`${QUICK_ADD_TASK} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('forwards text to client.quickAddTask and returns mapped task', async () => {
        const created = createMockTask({
            id: '8485093900',
            content: 'Call mom',
            priority: 'p2',
        })
        mockTodoistApi.quickAddTask.mockResolvedValueOnce(created)

        const result = await quickAddTask.execute(
            { text: 'Call mom tomorrow at 5pm #Personal p2' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.quickAddTask).toHaveBeenCalledTimes(1)
        expect(mockTodoistApi.quickAddTask).toHaveBeenCalledWith({
            text: 'Call mom tomorrow at 5pm #Personal p2',
            autoReminder: undefined,
        })
        expect(result.structuredContent).toEqual({
            task: expect.objectContaining({ id: '8485093900', content: 'Call mom' }),
        })
        expect(result.textContent).toContain('Added 1 task')
    })

    it('forwards autoReminder when provided', async () => {
        mockTodoistApi.quickAddTask.mockResolvedValueOnce(createMockTask())

        await quickAddTask.execute(
            { text: 'Buy milk tomorrow', autoReminder: true },
            mockTodoistApi,
        )

        expect(mockTodoistApi.quickAddTask).toHaveBeenCalledWith({
            text: 'Buy milk tomorrow',
            autoReminder: true,
        })
    })

    it('rejects empty text', async () => {
        await expect(quickAddTask.execute({ text: '' }, mockTodoistApi)).rejects.toThrow()
        expect(mockTodoistApi.quickAddTask).not.toHaveBeenCalled()
    })

    it('propagates API errors', async () => {
        mockTodoistApi.quickAddTask.mockRejectedValueOnce(new Error('API down'))

        await expect(quickAddTask.execute({ text: 'Anything' }, mockTodoistApi)).rejects.toThrow(
            'API down',
        )
    })
})
