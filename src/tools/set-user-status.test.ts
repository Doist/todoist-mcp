import {
    type SyncCommand,
    type SyncRequest,
    type SyncResponse,
    type TodoistApi,
    TodoistRequestError,
    type UserStatus,
} from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { ToolNames } from '../utils/tool-names.js'
import { setUserStatus } from './set-user-status.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { SET_USER_STATUS } = ToolNames

const NOW = new Date('2026-11-02T12:00:00Z')

type CommandResult =
    | 'ok'
    | 'unreported'
    | { error: string; http_code: number; error_code: number; error_tag: string }

/** What the mocked Sync API answers: the command's result, then the status it holds afterwards. */
let server: { commandResult: CommandResult; held: UserStatus | null | undefined }

function requests(): SyncRequest[] {
    return mockTodoistApi.sync.mock.calls.map(([request]) => request)
}

/** The `status` argument of the single `user_update` command the tool sent. */
function sentStatus(): unknown {
    const commands = requests().flatMap((request) => request.commands ?? [])
    expect(commands).toHaveLength(1)
    const [command] = commands
    if (!command) {
        throw new Error('No command was sent')
    }
    expect(command.type).toBe('user_update')
    return (command.args as { status: unknown }).status
}

function answer(request: SyncRequest): SyncResponse {
    if (request.commands) {
        const syncStatus =
            server.commandResult === 'unreported'
                ? {}
                : Object.fromEntries(
                      request.commands.map((command: SyncCommand) => [
                          command.uuid,
                          server.commandResult,
                      ]),
                  )
        return { syncStatus } as unknown as SyncResponse
    }
    return (server.held === undefined ? {} : { user: { status: server.held } }) as SyncResponse
}

const AWAY: UserStatus = { message: 'Away', emoji: null, activeUntil: null, effects: {} }

describe(`${SET_USER_STATUS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
        server = { commandResult: 'ok', held: AWAY }
        mockTodoistApi.sync.mockImplementation(async (request) => answer(request))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('writes the whole status, then reads it back in a separate request', async () => {
        server.held = {
            message: 'On holiday',
            emoji: '🏝️',
            activeUntil: new Date('2026-11-10T00:00:00Z'),
            effects: { pauseNotifications: {} },
        }

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
        const [write, read] = requests()
        expect(write?.resourceTypes).toBeUndefined()
        expect(read).toEqual({ resourceTypes: ['user'], syncToken: '*' })

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
        await setUserStatus.execute({ message: 'Away' }, mockTodoistApi)

        expect(sentStatus()).toEqual({
            message: 'Away',
            emoji: null,
            activeUntil: null,
            effects: null,
        })
    })

    it('pauses activity on its own', async () => {
        server.held = { ...AWAY, effects: { pauseActivity: {} } }

        const result = await setUserStatus.execute(
            { message: 'Away', pauseActivity: true },
            mockTodoistApi,
        )

        expect(sentStatus()).toMatchObject({
            effects: { pauseNotifications: null, pauseActivity: {} },
        })
        expect(result.structuredContent).toMatchObject({
            status: { pauseNotifications: false, pauseActivity: true },
        })
    })

    it('pauses notifications and activity together', async () => {
        server.held = { ...AWAY, effects: { pauseNotifications: {}, pauseActivity: {} } }

        await setUserStatus.execute(
            { message: 'Away', pauseNotifications: true, pauseActivity: true },
            mockTodoistApi,
        )

        expect(sentStatus()).toMatchObject({
            effects: { pauseNotifications: {}, pauseActivity: {} },
        })
    })

    it('converts an offset timestamp to UTC', async () => {
        server.held = { ...AWAY, activeUntil: new Date('2026-11-10T07:00:00Z') }

        await setUserStatus.execute(
            { message: 'Away', activeUntil: '2026-11-10T09:00+02:00' },
            mockTodoistApi,
        )

        expect(sentStatus()).toMatchObject({ activeUntil: '2026-11-10T07:00:00.000Z' })
    })

    it('accepts the widest real offsets', async () => {
        for (const activeUntil of ['2026-11-10T00:00:00+14:00', '2026-11-10T00:00:00-12:00']) {
            server.held = { ...AWAY, activeUntil: new Date(activeUntil) }
            await expect(
                setUserStatus.execute({ message: 'Away', activeUntil }, mockTodoistApi),
            ).resolves.toBeDefined()
        }
    })

    it('removes the status with clear', async () => {
        server.held = null

        const result = await setUserStatus.execute({ clear: true }, mockTodoistApi)

        expect(sentStatus()).toBeNull()
        expect(result.structuredContent).toEqual({ hasStatus: false })
        expect(result.textContent).toBe('Status cleared: none')
    })

    it('treats pause flags set to false as compatible with clear', async () => {
        server.held = null

        await setUserStatus.execute(
            { clear: true, pauseNotifications: false, pauseActivity: false },
            mockTodoistApi,
        )

        expect(sentStatus()).toBeNull()
    })

    it.each([
        ['a message', { message: 'Away' }],
        ['an empty message', { message: '' }],
        ['an emoji', { emoji: '🎯' }],
        ['an end', { activeUntil: '2026-11-10T00:00:00Z' }],
        ['a notification pause', { pauseNotifications: true }],
        ['an activity pause', { pauseActivity: true }],
    ])('refuses clear combined with %s without writing', async (_label, fields) => {
        await expect(
            setUserStatus.execute({ clear: true, ...fields }, mockTodoistApi),
        ).rejects.toThrow('cannot be combined with other fields')
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it.each([
        ['a date with no time', '2026-11-10'],
        ['a timestamp with no zone', '2026-11-10T09:00:00'],
        ['text that is not a date', 'next Monday'],
        ['an empty string', ''],
        ['a month that does not exist', '2026-13-01T00:00:00Z'],
        ['31 November', '2026-11-31T00:00:00Z'],
        ['30 February', '2027-02-30T00:00:00Z'],
        ['29 February outside a leap year', '2027-02-29T00:00:00Z'],
        ['hour 24', '2026-11-10T24:00:00Z'],
        ['minute 60', '2026-11-10T09:60:00Z'],
        ['a leap second', '2026-11-10T23:59:60Z'],
        ['an offset with minute 60', '2026-11-10T09:00:00+05:60'],
        ['an offset past +14:00', '2026-11-10T09:00:00+14:30'],
        ['an offset past -12:00', '2026-11-10T09:00:00-12:30'],
        ['an offset with no colon', '2026-11-10T09:00:00+0200'],
    ])('rejects %s for activeUntil without writing', async (_label, activeUntil) => {
        await expect(
            setUserStatus.execute({ message: 'Away', activeUntil }, mockTodoistApi),
        ).rejects.toThrow('activeUntil must be an ISO 8601 timestamp with Z or an offset')
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it('accepts 29 February in a leap year', async () => {
        server.held = { ...AWAY, activeUntil: new Date('2028-02-29T00:00:00Z') }

        await setUserStatus.execute(
            { message: 'Away', activeUntil: '2028-02-29T00:00:00Z' },
            mockTodoistApi,
        )

        expect(sentStatus()).toMatchObject({ activeUntil: '2028-02-29T00:00:00.000Z' })
    })

    it.each([
        ['in the past', '2026-11-02T11:59:00Z'],
        ['exactly now', '2026-11-02T12:00:00Z'],
    ])('rejects an end %s without writing', async (_label, activeUntil) => {
        await expect(
            setUserStatus.execute({ message: 'Away', activeUntil }, mockTodoistApi),
        ).rejects.toThrow('activeUntil must be in the future')
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it('requires a message unless clearing', async () => {
        await expect(setUserStatus.execute({ emoji: '🎯' }, mockTodoistApi)).rejects.toThrow(
            'message is required to set a status',
        )
        expect(mockTodoistApi.sync).not.toHaveBeenCalled()
    })

    it('fails with the error Todoist gave a rejected command, and reads nothing back', async () => {
        server.commandResult = {
            error: 'Insufficient token scope',
            http_code: 403,
            error_code: 403,
            error_tag: 'AUTH_INSUFFICIENT_TOKEN_SCOPE',
        }

        const error = await setUserStatus
            .execute({ message: 'Away' }, mockTodoistApi)
            .catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(TodoistRequestError)
        expect((error as TodoistRequestError).message).toBe('Insufficient token scope')
        expect((error as TodoistRequestError).responseData).toMatchObject({
            error_tag: 'AUTH_INSUFFICIENT_TOKEN_SCOPE',
        })
        expect(requests()).toHaveLength(1)
    })

    it('fails when Todoist does not report whether the write was applied', async () => {
        server.commandResult = 'unreported'

        await expect(setUserStatus.execute({ message: 'Away' }, mockTodoistApi)).rejects.toThrow(
            'Todoist did not report whether this change was applied',
        )
        expect(requests()).toHaveLength(1)
    })

    it('fails when the write is accepted but no status is held afterwards', async () => {
        server.held = null

        await expect(setUserStatus.execute({ message: 'Away' }, mockTodoistApi)).rejects.toThrow(
            'Todoist accepted the status but reports no active status',
        )
    })

    it('fails rather than present a different status as the one set', async () => {
        server.held = { ...AWAY, message: 'In a meeting', emoji: '📅' }

        await expect(
            setUserStatus.execute({ message: 'Away', emoji: '🏝️' }, mockTodoistApi),
        ).rejects.toThrow('Todoist accepted the status but reports a different one: "In a meeting"')
    })

    it.each([
        ['emoji', { emoji: '🎯' }],
        ['end', { activeUntil: new Date('2026-11-10T00:00:00Z') }],
        ['notification pause', { effects: { pauseNotifications: {} } }],
        ['activity pause', { effects: { pauseActivity: {} } }],
    ])('treats a held status with a different %s as a mismatch', async (_label, held) => {
        server.held = { ...AWAY, ...held }

        await expect(setUserStatus.execute({ message: 'Away' }, mockTodoistApi)).rejects.toThrow(
            'reports a different one',
        )
    })

    it('fails when a clear is accepted but a status is still held', async () => {
        await expect(setUserStatus.execute({ clear: true }, mockTodoistApi)).rejects.toThrow(
            'Todoist accepted the clear but still reports a status: "Away"',
        )
    })

    it('fails rather than report no status when the read-back has no user', async () => {
        server.held = undefined

        await expect(setUserStatus.execute({ message: 'Away' }, mockTodoistApi)).rejects.toThrow(
            'Todoist did not return the user',
        )
    })

    it('retries a failed write with the same command, so it cannot apply twice', async () => {
        mockTodoistApi.sync.mockRejectedValueOnce(
            new TodoistRequestError('Service unavailable', 503),
        )

        await setUserStatus.execute({ message: 'Away' }, mockTodoistApi)

        const writes = requests().filter((request) => request.commands)
        expect(writes).toHaveLength(2)
        expect(writes[0]?.commands?.[0]?.uuid).toBe(writes[1]?.commands?.[0]?.uuid)
    })

    describe('argument schema', () => {
        const schema = z.object(setUserStatus.parameters)

        it('trims the message and emoji', () => {
            expect(schema.parse({ message: '  Away  ', emoji: ' 🏝️ ' })).toEqual({
                message: 'Away',
                emoji: '🏝️',
            })
        })

        it.each([
            ['a whitespace-only message', { message: '   ' }],
            ['a message of 81 characters', { message: 'a'.repeat(81) }],
            ['a whitespace-only emoji', { message: 'Away', emoji: '  ' }],
        ])('rejects %s', (_label, args) => {
            expect(schema.safeParse(args).success).toBe(false)
        })

        it('counts the 80-character limit in characters, not UTF-16 units', () => {
            expect(schema.safeParse({ message: 'a'.repeat(80) }).success).toBe(true)
            expect(schema.safeParse({ message: '😀'.repeat(41) }).success).toBe(true)
        })
    })
})
