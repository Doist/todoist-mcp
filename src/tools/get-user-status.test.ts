import type { SyncResponse, TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { getUserStatus } from './get-user-status.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { GET_USER_STATUS } = ToolNames

describe(`${GET_USER_STATUS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('reads the status from the user resource', async () => {
        mockTodoistApi.sync.mockResolvedValue({
            user: {
                status: {
                    message: 'Out sick',
                    emoji: '🤒',
                    activeUntil: new Date('2026-11-04T00:00:00Z'),
                    effects: { pauseNotifications: {}, pauseActivity: {} },
                },
            },
        } as unknown as SyncResponse)

        const result = await getUserStatus.execute({}, mockTodoistApi)

        expect(mockTodoistApi.sync).toHaveBeenCalledWith({
            resourceTypes: ['user'],
            syncToken: '*',
        })
        expect(result.structuredContent).toEqual({
            hasStatus: true,
            status: {
                message: 'Out sick',
                emoji: '🤒',
                activeUntil: '2026-11-04T00:00:00.000Z',
                pauseNotifications: true,
                pauseActivity: true,
            },
        })
        expect(result.textContent).toBe(
            'Status: 🤒 Out sick\nUntil: 2026-11-04T00:00:00.000Z\nEffects: Comms notifications paused, Karma and streaks paused',
        )
    })

    it('leaves out fields the status does not have', async () => {
        mockTodoistApi.sync.mockResolvedValue({
            user: { status: { message: 'Deep work', emoji: null, activeUntil: null, effects: {} } },
        } as unknown as SyncResponse)

        const result = await getUserStatus.execute({}, mockTodoistApi)

        expect(result.structuredContent).toEqual({
            hasStatus: true,
            status: { message: 'Deep work', pauseNotifications: false, pauseActivity: false },
        })
        expect(result.textContent).toBe('Status: Deep work\nUntil: no end')
    })

    it('reports no status when there is none', async () => {
        mockTodoistApi.sync.mockResolvedValue({ user: { status: null } } as unknown as SyncResponse)

        const result = await getUserStatus.execute({}, mockTodoistApi)

        expect(result.structuredContent).toEqual({ hasStatus: false })
        expect(result.textContent).toBe('Status: none')
    })

    it('fails rather than report no status when the response has no user', async () => {
        mockTodoistApi.sync.mockResolvedValue({} as SyncResponse)

        await expect(getUserStatus.execute({}, mockTodoistApi)).rejects.toThrow(
            'Todoist did not return the user',
        )
    })
})
