import type { AddReminderArgs } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { countRemindersByType, mapReminder } from '../tool-helpers.js'
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
    ReminderNotifyUserSchema,
    ReminderServiceSchema,
} from '../utils/reminder-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeCreateWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const RelativeReminderInputSchema = z.object({
    type: z.literal('relative'),
    taskId: z.string().min(1).describe('The ID of the task to set a reminder for.'),
    minuteOffset: z
        .number()
        .int()
        .min(0)
        .describe(
            'Minutes before the task due time to trigger the reminder. E.g., 30 for 30 minutes before, 60 for 1 hour before, 1440 for 1 day before.',
        ),
    service: ReminderServiceSchema.optional().describe(
        'Delivery method: "email" or "push" notification. Defaults to push.',
    ),
    isUrgent: ReminderIsUrgentSchema,
    notifyUser: ReminderNotifyUserSchema,
})

const AbsoluteReminderInputSchema = z.object({
    type: z.literal('absolute'),
    taskId: z.string().min(1).describe('The ID of the task to set a reminder for.'),
    due: ReminderDueInputSchema.describe('The specific date/time for the reminder.'),
    service: ReminderServiceSchema.optional().describe(
        'Delivery method: "email" or "push" notification. Defaults to push.',
    ),
    isUrgent: ReminderIsUrgentSchema,
    notifyUser: ReminderNotifyUserSchema,
})

const LocationReminderInputSchema = z.object({
    type: z.literal('location'),
    taskId: z.string().min(1).describe('The ID of the task to set a reminder for.'),
    name: z.string().min(1).describe('Name of the location, e.g. "Office", "Home".'),
    locLat: z.string().describe('Latitude of the location as a string, e.g. "37.7749".'),
    locLong: z.string().describe('Longitude of the location as a string, e.g. "-122.4194".'),
    locTrigger: LocationTriggerSchema.describe(
        'When to trigger: "on_enter" (arriving) or "on_leave" (departing).',
    ),
    radius: z
        .number()
        .int()
        .optional()
        .describe('Radius in meters for the geofence. Defaults to server default.'),
    notifyUser: ReminderNotifyUserSchema,
})

const ReminderInputSchema = z.discriminatedUnion('type', [
    RelativeReminderInputSchema,
    AbsoluteReminderInputSchema,
    LocationReminderInputSchema,
])

const ArgsSchema = {
    reminders: z
        .array(ReminderInputSchema)
        .min(1)
        .max(MAX_REMINDERS_PER_OPERATION)
        .describe(
            `Array of reminders to create (max ${MAX_REMINDERS_PER_OPERATION}). Each reminder must specify a type: "relative" (minutes before due), "absolute" (specific date/time), or "location" (geofence trigger).`,
        ),
}

const OutputSchema = {
    reminders: z.array(ReminderOutputSchema).describe('The created reminders.'),
    totalCount: z.number().describe('Total number of reminders created.'),
    addedReminderIds: z.array(z.string()).describe('IDs of the created reminders.'),
    failures: z
        .array(FailureSchema)
        .describe('Reminders that could not be created, with the reason for each.'),
    totalRequested: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
}

const addReminders = {
    name: ToolNames.ADD_REMINDERS,
    description:
        'Add reminders to tasks. Supports three types: "relative" (minutes before due), "absolute" (specific date/time), or "location" (geofence-triggered). Each reminder must specify a taskId. Reminders notify their creator unless notifyUser says otherwise.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
    async execute(args, client) {
        const { reminders } = args

        const recipients = await resolveReminderRecipients(
            client,
            reminders.map((reminder) => reminder.notifyUser),
        )

        // Each reminder is created independently, so one rejection (or an unresolvable
        // notifyUser) neither discards the reminders that were created nor hides them.
        // A create retries only a 503: after a 502/504 the reminder may already exist.
        const settled = await Promise.allSettled(
            reminders.map(async (reminder, index) => {
                const recipient = recipients[index]
                if (recipient?.status === 'rejected') {
                    throw recipient.reason
                }
                const notifyUid = recipient?.value
                switch (reminder.type) {
                    case 'relative':
                        return await executeCreateWithRetry(() =>
                            client.addReminder({
                                taskId: reminder.taskId,
                                reminderType: 'relative',
                                minuteOffset: reminder.minuteOffset,
                                service: reminder.service,
                                isUrgent: reminder.isUrgent,
                                notifyUid,
                            } as AddReminderArgs),
                        )
                    case 'absolute':
                        return await executeCreateWithRetry(() =>
                            client.addReminder({
                                taskId: reminder.taskId,
                                reminderType: 'absolute',
                                due: reminder.due,
                                service: reminder.service,
                                isUrgent: reminder.isUrgent,
                                notifyUid,
                            } as AddReminderArgs),
                        )
                    case 'location':
                        return await executeCreateWithRetry(() =>
                            client.addLocationReminder({
                                taskId: reminder.taskId,
                                name: reminder.name,
                                locLat: reminder.locLat,
                                locLong: reminder.locLong,
                                locTrigger: reminder.locTrigger,
                                radius: reminder.radius,
                                notifyUid,
                            }),
                        )
                }
            }),
        )

        const mappedReminders: ReturnType<typeof mapReminder>[] = []
        // The recipient each created reminder asked for, aligned with `mappedReminders`.
        const requestedUids: (string | undefined)[] = []
        const failures: Array<{ item: string; error: string }> = []

        settled.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                mappedReminders.push(mapReminder(result.value))
                const recipient = recipients[index]
                requestedUids.push(recipient?.status === 'fulfilled' ? recipient.value : undefined)
            } else {
                failures.push({
                    item: `Reminder ${index + 1} on task ${reminders[index]?.taskId}`,
                    error: formatBatchItemError(result.reason),
                })
            }
        })

        logBatchFailures(ToolNames.ADD_REMINDERS, reminders.length, failures)

        const textContent = appendFailureSummary(
            [
                generateTextContent(mappedReminders),
                ...describeRecipientMismatches(mappedReminders, requestedUids),
            ].join('\n'),
            failures,
        )

        return {
            textContent,
            structuredContent: {
                reminders: mappedReminders,
                totalCount: mappedReminders.length,
                addedReminderIds: mappedReminders.map((r) => r.id),
                failures,
                totalRequested: reminders.length,
                successCount: mappedReminders.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent(reminders: ReturnType<typeof mapReminder>[]): string {
    const { timeBasedCount, locationCount } = countRemindersByType(reminders)

    const parts: string[] = []
    if (timeBasedCount > 0) {
        const label = timeBasedCount > 1 ? 'reminders' : 'reminder'
        parts.push(`${timeBasedCount} time-based ${label}`)
    }
    if (locationCount > 0) {
        const label = locationCount > 1 ? 'reminders' : 'reminder'
        parts.push(`${locationCount} location ${label}`)
    }

    return parts.length > 0 ? `Added ${parts.join(' and ')}` : 'No reminders added'
}

export { addReminders }
