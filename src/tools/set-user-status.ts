import { createCommand, type UserStatusArgs } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'
import { buildUserStatusResult, readStatus, UserStatusOutputSchema } from '../utils/user-status.js'

const MAX_MESSAGE_LENGTH = 80

const ArgsSchema = {
    message: z
        .string()
        .trim()
        .min(1)
        .max(MAX_MESSAGE_LENGTH)
        .optional()
        .describe('Required unless clear is true.'),
    emoji: z.string().trim().min(1).optional(),
    activeUntil: z
        .string()
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

// Matches an ISO 8601 timestamp that carries its own zone, so it never depends on the server's.
const ZONED_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

function parseActiveUntil(value: string, now: Date): string {
    const parsed = ZONED_TIMESTAMP.test(value) ? new Date(value) : undefined
    if (!parsed || Number.isNaN(parsed.getTime())) {
        throw new Error(
            `activeUntil must be an ISO 8601 timestamp with Z or an offset, such as "2026-11-10T00:00:00+00:00". Got "${value}".`,
        )
    }
    if (parsed.getTime() <= now.getTime()) {
        throw new Error(`activeUntil must be in the future. Got "${value}".`)
    }
    return parsed.toISOString()
}

/** The whole status to store, or `null` to remove it. Omitted fields are cleared, not kept. */
function buildStatus(args: SetUserStatusArgs, now: Date): UserStatusArgs | null {
    const { clear, message, emoji, activeUntil, pauseNotifications, pauseActivity } = args

    if (clear) {
        const others = [message, emoji, activeUntil, pauseNotifications, pauseActivity]
        if (others.some((value) => value !== undefined)) {
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
        activeUntil: activeUntil ? parseActiveUntil(activeUntil, now) : null,
        effects:
            pauseNotifications || pauseActivity
                ? {
                      pauseNotifications: pauseNotifications ? {} : null,
                      pauseActivity: pauseActivity ? {} : null,
                  }
                : null,
    }
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
        // The Sync API skips a command whose uuid it has already applied, so a retry cannot write twice.
        const command = createCommand('user_update', { status })
        const response = await executeWithRetry(() =>
            client.sync({ commands: [command], resourceTypes: ['user'], syncToken: '*' }),
        )
        return buildUserStatusResult(
            readStatus(response),
            status ? 'Status set' : 'Status after clearing',
        )
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof UserStatusOutputSchema>

export { setUserStatus }
