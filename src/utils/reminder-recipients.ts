import type { TodoistApi } from '@doist/todoist-sdk'
import { resolveUserRefs } from './user-resolver.js'

/**
 * Resolve each reminder's `notifyUser` reference to a user ID.
 *
 * The result lines up with the input. Each entry is settled on its own, so a
 * reference that cannot be resolved fails only the reminders that use it. A
 * reminder with no reference resolves to `undefined`, which keeps Todoist's
 * default of notifying its creator.
 */
export async function resolveReminderRecipients(
    client: TodoistApi,
    notifyUsers: (string | undefined)[],
): Promise<PromiseSettledResult<string | undefined>[]> {
    // References that differ only in case or padding are the same person, as in
    // `resolveUserRefs`, but the first spelling is what gets resolved, since a
    // user ID is not safe to lower-case.
    const refsByKey = new Map<string, string>()
    for (const ref of notifyUsers) {
        const trimmed = ref?.trim()
        if (trimmed && !refsByKey.has(toKey(trimmed))) refsByKey.set(toKey(trimmed), trimmed)
    }

    // Resolved one at a time on purpose: the first lookup populates the
    // collaborator cache that the rest read.
    const outcomes = new Map<string, PromiseSettledResult<string | undefined>>()
    for (const [key, ref] of refsByKey) {
        try {
            const [user] = await resolveUserRefs(client, [ref])
            outcomes.set(key, { status: 'fulfilled', value: user?.userId })
        } catch (reason) {
            outcomes.set(key, { status: 'rejected', reason })
        }
    }

    const noReference: PromiseSettledResult<undefined> = { status: 'fulfilled', value: undefined }
    return notifyUsers.map((ref) =>
        ref?.trim() ? (outcomes.get(toKey(ref)) ?? noReference) : noReference,
    )
}

function toKey(ref: string): string {
    return ref.trim().toLowerCase()
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
