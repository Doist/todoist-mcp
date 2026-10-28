import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { mapReminder } from '../tool-helpers.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { FailureSchema, ReminderSchema as ReminderOutputSchema } from '../utils/output-schemas.js'
import {
    describeRecipientMismatches,
    resolveReminderRecipients,
} from '../utils/reminder-recipients.js'
import {
    LocationTriggerSchema,
    MAX_REMINDERS_PER_OPERATION,
    ReminderDueInputSchema,
    ReminderIsUrgentSchema,
    ReminderNotifyUserUpdateSchema,
    ReminderServiceSchema,
} from '../utils/reminder-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const RelativeReminderUpdateSchema = z.object({
    type: z.literal('relative'),
    id: z.string().min(1).describe('The ID of the relative reminder to update.'),
    minuteOffset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('New minute offset before task due time.'),
    service: ReminderServiceSchema.optional().describe('New delivery method: "email" or "push".'),
    isUrgent: ReminderIsUrgentSchema,
    notifyUser: ReminderNotifyUserUpdateSchema,
})

const AbsoluteReminderUpdateSchema = z.object({
    type: z.literal('absolute'),
    id: z.string().min(1).describe('The ID of the absolute reminder to update.'),
    due: ReminderDueInputSchema.optional().describe('New due date/time for the reminder.'),
    service: ReminderServiceSchema.optional().describe('New delivery method: "email" or "push".'),
    isUrgent: ReminderIsUrgentSchema,
    notifyUser: ReminderNotifyUserUpdateSchema,
})

const LocationReminderUpdateSchema = z.object({
    type: z.literal('location'),
    id: z.string().min(1).describe('The ID of the location reminder to update.'),
    name: z.string().optional().describe('New location name.'),
    locLat: z.string().optional().describe('New latitude.'),
    locLong: z.string().optional().describe('New longitude.'),
    locTrigger: LocationTriggerSchema.optional().describe(
        'New trigger condition: "on_enter" or "on_leave".',
    ),
    radius: z.number().int().optional().describe('New radius in meters.'),
    notifyUser: ReminderNotifyUserUpdateSchema,
})

const ReminderUpdateSchema = z.discriminatedUnion('type', [
    RelativeReminderUpdateSchema,
    AbsoluteReminderUpdateSchema,
    LocationReminderUpdateSchema,
])

const ArgsSchema = {
    reminders: z
        .array(ReminderUpdateSchema)
        .min(1)
        .max(MAX_REMINDERS_PER_OPERATION)
        .describe(
            `Array of reminders to update (max ${MAX_REMINDERS_PER_OPERATION}). Each must include the reminder type and ID. Only include fields that need to change.`,
        ),
}

const OutputSchema = {
    reminders: z.array(ReminderOutputSchema).describe('The updated reminders.'),
    totalCount: z.number().describe('Total reminders updated.'),
    updatedReminderIds: z.array(z.string()).describe('IDs of updated reminders.'),
    failures: z
        .array(FailureSchema)
        .describe('Reminders that could not be updated, with the reason for each.'),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('Number of reminders updated.'),
            failureCount: z.number().describe('Number of reminders that failed to update.'),
        })
        .describe('Summary of operations performed.'),
}

const updateReminders = {
    name: ToolNames.UPDATE_REMINDERS,
    description:
        'Update existing reminders. Each reminder must specify its type ("relative", "absolute", or "location") and ID. Only include fields that need to change.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
    },
    async execute(args, client) {
        const { reminders } = args

        const recipients = await resolveReminderRecipients(
            client,
            reminders.map((reminder) => reminder.notifyUser),
        )

        // Each reminder is updated independently, so one rejection (or an unresolvable
        // notifyUser) neither discards the reminders that were updated nor hides them.
        const settled = await Promise.allSettled(
            reminders.map(async (reminder, index) => {
                const recipient = recipients[index]
                if (recipient?.status === 'rejected') {
                    throw recipient.reason
                }
                const notifyUid = recipient?.value
                const recipientArgs = notifyUid !== undefined ? { notifyUid } : {}
                switch (reminder.type) {
                    case 'relative': {
                        const { id, type: _, notifyUser: __, ...updateArgs } = reminder
                        return await executeWithRetry(() =>
                            client.updateReminder(id, {
                                reminderType: 'relative',
                                ...updateArgs,
                                ...recipientArgs,
                            }),
                        )
                    }
                    case 'absolute': {
                        const { id, type: _, notifyUser: __, ...updateArgs } = reminder
                        return await executeWithRetry(() =>
                            client.updateReminder(id, {
                                reminderType: 'absolute',
                                ...updateArgs,
                                ...recipientArgs,
                            }),
                        )
                    }
                    case 'location': {
                        const { id, type: _, notifyUser: __, ...updateArgs } = reminder
                        return await executeWithRetry(() =>
                            client.updateLocationReminder(id, { ...updateArgs, ...recipientArgs }),
                        )
                    }
                }
            }),
        )

        const mappedReminders: ReturnType<typeof mapReminder>[] = []
        // The recipient each updated reminder asked for, aligned with `mappedReminders`.
        const requestedUids: (string | undefined)[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                mappedReminders.push(mapReminder(result.value))
                const recipient = recipients[index]
                requestedUids.push(recipient?.status === 'fulfilled' ? recipient.value : undefined)
            } else {
                failures.push({
                    item: reminders[index]?.id ?? `Reminder ${index + 1}`,
                    error: formatBatchItemError(result.reason),
                })
            }
        })

        logBatchFailures(ToolNames.UPDATE_REMINDERS, reminders.length, failures)

        const label = mappedReminders.length === 1 ? 'reminder' : 'reminders'
        const textContent = appendFailureSummary(
            [
                `Updated ${mappedReminders.length} ${label}`,
                ...describeRecipientMismatches(mappedReminders, requestedUids),
            ].join('\n'),
            failures,
        )

        return {
            textContent,
            structuredContent: {
                reminders: mappedReminders,
                totalCount: mappedReminders.length,
                updatedReminderIds: mappedReminders.map((r) => r.id),
                failures,
                appliedOperations: {
                    updateCount: mappedReminders.length,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { updateReminders }
