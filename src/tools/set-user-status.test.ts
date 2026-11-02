import type { SyncRequest, SyncResponse, TodoistApi, UserStatus } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { setUserStatus } from './set-user-status.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { SET_USER_STATUS } = ToolNames

const NOW = new Date('2026-11-02T12:00:00Z')

function syncResponse(status: UserStatus | null): SyncResponse {
    return { user: { status } } as unknown as SyncResponse
}

/** The `status` argument of the single `user_update` command the tool sent. */
function sentStatus(): unknown {
    const request = mockTodoistApi.sync.mock.calls[0]?.[0] as SyncRequest
    expect(request.commands).toHaveLength(1)
    const [command] = request.commands ?? []
    if (!command) {
        throw new Error('No command was sent')
    }
    expect(command.type).toBe('user_update')
    return (command.args as { status: unknown }).status
}

describe(`${SET_USER_STATUS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers({ now: NOW })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('sends the whole status and reads back what the server holds', async () => {
        mockTodoistApi.sync.mockResolvedValue(
            syncResponse({
                message: 'On holiday',
                emoji: '🏝️',
                activeUntil: new Date('2026-11-10T00:00:00Z'),
                effects: { pauseNotifications: {} },
            }),
        )

        const result = await setUserStatus.execute(
            {
                message: 'On holiday',
                emoji: '🏝️',
                activeUntil: '2026-11-10T00:00:00+00:00',
                pauseNotifications: true,
            },
            mockTodoistApi,
        )

        expect(sentStatus()).toEqual({
            message: 'On holiday',
            emoji: '🏝️',
            activeUntil: '2026-11-10T00:00:00.000Z',
            effects: { pauseNotifications: {}, pauseActivity: null },
        })
        const request = mockTodoistApi.sync.mock.calls[0]?.[0] as SyncRequest
        expect(request.resourceTypes).toEqual(['user'])

        expect(result.structuredContent).toEqual({
            hasStatus: true,
            status: {
                message: 'On holiday',
                emoji: '🏝️',
                activeUntil: '2026-11-10T00:00:00.000Z',
                pauseNotifications: true,
                pauseActivity: false,
            },
        })
        expect(result.textContent).toContain('Status set: 🏝️ On holiday')
        expect(result.textContent).toContain('Comms notifications paused')
    })

    it('clears the emoji, end and effects it is not given, rather than keeping them', async () => {
        mockTodoistApi.sync.mockResolvedValue(syncResponse({ message: 'Deep work', effects: {} }))

        await setUserStatus.execute({ message: 'Deep work' }, mockTodoistApi)

        expect(sentStatus()).toEqual({
            message: 'Deep work',
            emoji: null,
            activeUntil: null,
            effects: null,
        })
    })

    it('converts an offset timestamp to UTC', async () => {
        mockTodoistApi.sync.mockResolvedValue(syncResponse({ message: 'Away', effects: {} }))

        await setUserStatus.execute(
            { message: 'Away', activeUntil: '2026-11-10T09:00+02:00' },
            mockTodoistApi,
        )

        expect(sentStatus()).toMatchObject({ activeUntil: '2026-11-10T07:00:00.000Z' })
    })

    it('removes the status with clear', async () => {
        mockTodoistApi.sync.mockResolvedValue(syncResponse(null))

        const result = await setUserStatus.execute({ clear: true }, mockTodoistApi)

        expect(sentStatus()).toBeNull()
        expect(result.structuredContent).toEqual({ hasStatus: false })
        expect(result.textContent).toBe('Status after clearing: none')
    })

    it.each([
        ['a date with no time', '2026-11-10'],
        ['a timestamp with no zone', '2026-11-10T09:00:00'],
        ['text that is not a date', 'next Monday'],
        ['an impossible date', '2026-13-40T00:00:00Z'],
    ])('rejects %s for activeUntil without writing', async (_label, activeUntil) => {
        await expect(
            setUserStatus.execute({ message: 'Away', activeUntil }, mockTodoistApi),
        ).rejects.toThrow('activeUntil must be an ISO 8601 timestamp with Z or an offset')
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it('rejects an end in the past without writing', async () => {
        await expect(
            setUserStatus.execute(
                { message: 'Away', activeUntil: '2026-11-02T11:59:00Z' },
                mockTodoistApi,
            ),
        ).rejects.toThrow('activeUntil must be in the future')
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it('requires a message unless clearing', async () => {
        await expect(setUserStatus.execute({ emoji: '🎯' }, mockTodoistApi)).rejects.toThrow(
            'message is required to set a status',
        )
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it('refuses clear combined with other fields', async () => {
        await expect(
            setUserStatus.execute({ clear: true, message: 'Away' }, mockTodoistApi),
        ).rejects.toThrow('cannot be combined with other fields')
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it('fails rather than report no status when the response has no user', async () => {
        mockTodoistApi.sync.mockResolvedValue({} as SyncResponse)

        await expect(setUserStatus.execute({ message: 'Away' }, mockTodoistApi)).rejects.toThrow(
            'Todoist did not return the user',
        )
    })

    it('propagates a rejected command, such as a token without the user scope', async () => {
        mockTodoistApi.sync.mockRejectedValue(new Error('Forbidden'))

        await expect(setUserStatus.execute({ message: 'Away' }, mockTodoistApi)).rejects.toThrow(
            'Forbidden',
        )
    })
})
