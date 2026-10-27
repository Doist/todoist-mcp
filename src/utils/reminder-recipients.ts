import type { TodoistApi } from '@doist/todoist-sdk'
import { resolveUserRefs } from './user-resolver.js'

/**
 * Resolve each reminder's `notifyUser` reference to a user ID.
 *
 * The result lines up with the input, with `undefined` wherever no reference
 * was given, so the reminder keeps Todoist's default of notifying its creator.
 *
 * @throws Error naming the first reference that could not be resolved
 */
export async function resolveReminderRecipients(
    client: TodoistApi,
    notifyUsers: (string | undefined)[],
): Promise<(string | undefined)[]> {
    const userIds = new Map<string, string>()

    // Resolved one at a time on purpose: the first lookup populates the
    // collaborator cache that the rest read.
    for (const ref of new Set(notifyUsers.map((ref) => ref?.trim()))) {
        if (!ref) continue
        const [user] = await resolveUserRefs(client, [ref])
        if (user) userIds.set(ref, user.userId)
    }

    return notifyUsers.map((ref) => (ref ? userIds.get(ref.trim()) : undefined))
}

/**
 * Warn about every reminder that notifies someone other than the user it was
 * meant for, which happens when Todoist does not apply the requested recipient.
 * Without this, the tool would report success while the reminder silently
 * reaches the wrong person.
 */
export function describeRecipientMismatches(
    reminders: { id: string; notifyUid?: string }[],
    requestedUserIds: (string | undefined)[],
): string[] {
    return reminders.flatMap((reminder, index) => {
        const requested = requestedUserIds[index]
        if (!requested || reminder.notifyUid === requested) return []
        return [
            `Warning: reminder ${reminder.id} notifies user ${reminder.notifyUid ?? 'unknown'}, not the requested user ${requested}. Todoist did not apply notifyUser.`,
        ]
    })
}
