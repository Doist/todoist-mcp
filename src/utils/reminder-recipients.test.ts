import type { TodoistApi } from '@doist/todoist-sdk'
import { vi } from 'vitest'
import { describeRecipientMismatches, resolveReminderRecipients } from './reminder-recipients.js'
import { resolveUserRefs } from './user-resolver.js'

vi.mock('./user-resolver.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./user-resolver.js')>()
    return { ...actual, resolveUserRefs: vi.fn() }
})

const mockResolveUserRefs = vi.mocked(resolveUserRefs)
const client = {} as TodoistApi

const USER_IDS: Record<string, string> = { Ana: 'user-2', me: 'user-1' }

describe('resolveReminderRecipients', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockResolveUserRefs.mockImplementation(async (_client, refs) =>
            refs.map((ref) => {
                const userId = USER_IDS[ref]
                if (!userId) throw new Error(`Could not find user(s): "${ref}".`)
                return { userId, displayName: ref, email: ref }
            }),
        )
    })

    it('lines the resolved IDs up with the input, leaving unset entries undefined', async () => {
        const result = await resolveReminderRecipients(client, [undefined, 'Ana', 'me', ''])

        expect(result).toEqual([undefined, 'user-2', 'user-1', undefined])
    })

    it('resolves references that differ only in case or padding once, by their first spelling', async () => {
        const result = await resolveReminderRecipients(client, ['Ana', ' ana ', 'ANA'])

        expect(mockResolveUserRefs).toHaveBeenCalledTimes(1)
        expect(mockResolveUserRefs).toHaveBeenCalledWith(client, ['Ana'])
        expect(result).toEqual(['user-2', 'user-2', 'user-2'])
    })

    it('fails instead of dropping a reference it cannot resolve', async () => {
        await expect(resolveReminderRecipients(client, ['Ana', 'Bob'])).rejects.toThrow(
            'Could not find user(s): "Bob".',
        )
    })
})

describe('describeRecipientMismatches', () => {
    it('says nothing when every reminder notifies the requested user or none was requested', () => {
        const reminders = [
            { id: 'r-1', notifyUid: 'user-2' },
            { id: 'r-2', notifyUid: 'user-1' },
        ]

        expect(describeRecipientMismatches(reminders, ['user-2', undefined])).toEqual([])
    })

    it('warns about each reminder that notifies someone else', () => {
        const reminders = [
            { id: 'r-1', notifyUid: 'user-1' },
            { id: 'r-2', notifyUid: 'user-2' },
        ]

        expect(describeRecipientMismatches(reminders, ['user-2', 'user-2'])).toEqual([
            'Warning: reminder r-1 notifies user user-1, not the requested user user-2. Todoist did not apply notifyUser.',
        ])
    })
})
