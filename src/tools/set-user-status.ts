import { createCommand, type UserStatus, type UserStatusArgs } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { settleSyncCommands } from '../utils/sync-commands.js'
import { ToolNames } from '../utils/tool-names.js'
import {
    buildUserStatusResult,
    fetchUserStatus,
    UserStatusOutputSchema,
} from '../utils/user-status.js'

const MAX_MESSAGE_LENGTH = 80

const ArgsSchema = {
    message: z
        .string()
        .trim()
        .min(1)
        .max(MAX_MESSAGE_LENGTH)
        .optional()
        .describe('Required unless clear is true.'),
    emoji: z.string().trim().min(1).optional().describe('A Unicode emoji, such as 🏝️.'),
    activeUntil: z
        .string()
        .trim()
        .optional()
        .describe(
            'When it ends: a future ISO 8601 timestamp with Z or an offset, e.g. 2026-11-10T00:00:00+00:00. Omit for no end.',
        ),
    pauseNotifications: z
        .boolean()
        .optional()
        .describe('Hold back Comms notifications while active. They are not sent later.'),
    pauseActivity: z.boolean().optional().describe('Pause Karma and streaks while active.'),
    clear: z.boolean().optional().describe('Remove the status. Use alone.'),
}

type SetUserStatusArgs = {
    message?: string
    emoji?: string
    activeUntil?: string
    pauseNotifications?: boolean
    pauseActivity?: boolean
    clear?: boolean
}

// An ISO 8601 timestamp that carries its own zone, so it never depends on the server's.
const ZONED_TIMESTAMP =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/i

// The offsets in use worldwide run from UTC-12:00 to UTC+14:00.
const MIN_OFFSET_MINUTES = -12 * 60
const MAX_OFFSET_MINUTES = 14 * 60

function invalidActiveUntil(value: string): Error {
    return new Error(
        `activeUntil must be an ISO 8601 timestamp with Z or an offset, such as "2026-11-10T00:00:00+00:00". Got "${value}".`,
    )
}

function parseActiveUntil(value: string, now: Date): string {
    const match = ZONED_TIMESTAMP.exec(value)
    if (!match) {
        throw invalidActiveUntil(value)
    }
    const [, year, month, day, hour, minute, second = '0', zone, sign, offsetHours, offsetMinutes] =
        match
    const [y, mo, d, h, mi, s] = [year, month, day, hour, minute, second].map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
    ]

    // `Date` rolls an impossible day or time over (31 November becomes 1 December), so build the
    // wall-clock instant and require every part to survive the round trip. `setUTCFullYear` keeps
    // the years 0 to 99, which `Date.UTC` would read as 1900 to 1999.
    const wallClock = new Date(0)
    wallClock.setUTCFullYear(y, mo - 1, d)
    wallClock.setUTCHours(h, mi, s)
    const partsSurvive =
        wallClock.getUTCFullYear() === y &&
        wallClock.getUTCMonth() === mo - 1 &&
        wallClock.getUTCDate() === d &&
        wallClock.getUTCHours() === h &&
        wallClock.getUTCMinutes() === mi &&
        wallClock.getUTCSeconds() === s
    const offset =
        zone?.toUpperCase() === 'Z'
            ? 0
            : (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes))
    if (!partsSurvive || offset < MIN_OFFSET_MINUTES || offset > MAX_OFFSET_MINUTES) {
        throw invalidActiveUntil(value)
    }

    // Sub-second precision and offset minutes are checked by `Date` itself, now that the date and
    // time are known to be real.
    const parsed = new Date(value.toUpperCase())
    if (Number.isNaN(parsed.getTime())) {
        throw invalidActiveUntil(value)
    }
    if (parsed.getTime() <= now.getTime()) {
        throw new Error(`activeUntil must be in the future. Got "${value}".`)
    }
    return parsed.toISOString()
}

// An explicit scope, because `{}` keeps whatever scope another client stored for the effect.
const ALL_SCOPE = { scope: { mode: 'all' } }

/** The whole status to store, or `null` to remove it. Omitted fields are cleared, not kept. */
function buildStatus(args: SetUserStatusArgs, now: Date): UserStatusArgs | null {
    const { clear, message, emoji, activeUntil, pauseNotifications, pauseActivity } = args

    if (clear) {
        // A pause flag set to false asks for nothing, so it does not conflict with clear.
        const setsSomething =
            message !== undefined ||
            emoji !== undefined ||
            activeUntil !== undefined ||
            pauseNotifications === true ||
            pauseActivity === true
        if (setsSomething) {
            throw new Error('clear removes the status, so it cannot be combined with other fields.')
        }
        return null
    }

    if (!message) {
        throw new Error('message is required to set a status. Pass clear: true to remove it.')
    }

    return {
        message,
        emoji: emoji ?? null,
        activeUntil: activeUntil !== undefined ? parseActiveUntil(activeUntil, now) : null,
        effects:
            pauseNotifications || pauseActivity
                ? {
                      pauseNotifications: pauseNotifications ? ALL_SCOPE : null,
                      pauseActivity: pauseActivity ? ALL_SCOPE : null,
                  }
                : null,
    }
}

function sameStatus(held: UserStatus, sent: UserStatusArgs): boolean {
    const heldUntil = held.activeUntil ? new Date(held.activeUntil).getTime() : null
    const sentUntil = sent.activeUntil ? new Date(sent.activeUntil).getTime() : null
    return (
        held.message === sent.message &&
        (held.emoji || null) === (sent.emoji ?? null) &&
        heldUntil === sentUntil &&
        Boolean(held.effects?.pauseNotifications) === Boolean(sent.effects?.pauseNotifications) &&
        Boolean(held.effects?.pauseActivity) === Boolean(sent.effects?.pauseActivity)
    )
}

const setUserStatus = {
    name: ToolNames.SET_USER_STATUS,
    description:
        "Set or clear the user's status, shown next to their name in Todoist and Comms. Replaces the whole status: an omitted emoji, end or effect is removed, not kept. Use clear to remove the status.",
    parameters: ArgsSchema,
    outputSchema: UserStatusOutputSchema,
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
    },
    async execute(args, client) {
        const status = buildStatus(args, new Date())

        // The write goes alone so its own result is checked, rather than inferred from a read-back.
        const {
            outcomes: [outcome],
        } = await settleSyncCommands(client, [createCommand('user_update', { status })])
        if (outcome?.status !== 'fulfilled') {
            throw (
                outcome?.reason ??
                new Error('Todoist did not report whether the status was applied.')
            )
        }

        // Anything else that writes the status (Comms, another client) can land between the write
        // and the read-back, so report a mismatch rather than present another status as this one.
        const held = await fetchUserStatus(client).catch((error: unknown) => {
            // Not a request error any more, so nothing above retries it and writes a second time.
            const reason = error instanceof Error ? error.message : String(error)
            throw new Error(
                `The status was written, but reading it back failed, so it is unconfirmed: ${reason}. Use ${ToolNames.GET_USER_STATUS} to check it.`,
            )
        })
        if (status === null) {
            if (held) {
                throw new Error(
                    `Todoist accepted the clear but still reports a status: "${held.message}". Another app may have set it at the same moment.`,
                )
            }
            return buildUserStatusResult(null, 'Status cleared')
        }
        if (!held) {
            throw new Error(
                'Todoist accepted the status but reports no active status, so it may have expired already.',
            )
        }
        if (!sameStatus(held, status)) {
            throw new Error(
                `Todoist accepted the status but reports a different one: "${held.message}". Another app may have changed it at the same moment.`,
            )
        }
        return buildUserStatusResult(held, 'Status set')
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof UserStatusOutputSchema>

export { setUserStatus }
