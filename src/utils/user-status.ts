import type { SyncResponse, TodoistApi, UserStatus } from '@doist/todoist-sdk'
import { z } from 'zod'
import { executeWithRetry } from './retry.js'

const StatusOutputSchema = z.object({
    message: z.string(),
    emoji: z.string().optional(),
    activeUntil: z.string().optional().describe('ISO 8601 end. Omitted when it has no end.'),
    pauseNotifications: z.boolean().describe('Comms notifications held back.'),
    pauseActivity: z.boolean().describe('Karma and streaks paused.'),
})

const UserStatusOutputSchema = {
    hasStatus: z.boolean(),
    status: StatusOutputSchema.optional().describe('Omitted when there is no active status.'),
}

type StatusOutput = z.infer<typeof StatusOutputSchema>

type UserStatusStructured = {
    hasStatus: boolean
    status?: StatusOutput
}

// A response without the user cannot tell "no status" from "nothing came back".
function readStatus(response: SyncResponse): UserStatus | null {
    if (!response.user) {
        throw new Error('Todoist did not return the user, so the status is unknown.')
    }
    return response.user.status ?? null
}

/** The user's active status, or `null` when there is none or it has expired. */
async function fetchUserStatus(client: TodoistApi): Promise<UserStatus | null> {
    const response = await executeWithRetry(() =>
        client.sync({ resourceTypes: ['user'], syncToken: '*' }),
    )
    return readStatus(response)
}

function toStatusOutput(status: UserStatus): StatusOutput {
    const activeUntil = status.activeUntil ? new Date(status.activeUntil).toISOString() : undefined
    return {
        message: status.message,
        ...(status.emoji ? { emoji: status.emoji } : {}),
        ...(activeUntil ? { activeUntil } : {}),
        pauseNotifications: Boolean(status.effects?.pauseNotifications),
        pauseActivity: Boolean(status.effects?.pauseActivity),
    }
}

function buildUserStatusResult(
    status: UserStatus | null,
    heading: string,
): { textContent: string; structuredContent: UserStatusStructured } {
    if (!status) {
        return {
            textContent: `${heading}: none`,
            structuredContent: { hasStatus: false },
        }
    }

    const output = toStatusOutput(status)
    const lines = [`${heading}: ${output.emoji ? `${output.emoji} ` : ''}${output.message}`]
    lines.push(output.activeUntil ? `Until: ${output.activeUntil}` : 'Until: no end')
    const effects = [
        output.pauseNotifications ? 'Comms notifications paused' : undefined,
        output.pauseActivity ? 'Karma and streaks paused' : undefined,
    ].filter((effect): effect is string => effect !== undefined)
    if (effects.length > 0) {
        lines.push(`Effects: ${effects.join(', ')}`)
    }

    return {
        textContent: lines.join('\n'),
        structuredContent: { hasStatus: true, status: output },
    }
}

export { buildUserStatusResult, fetchUserStatus, UserStatusOutputSchema }
