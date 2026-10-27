import { LOCATION_TRIGGERS, REMINDER_DELIVERY_SERVICES } from '@doist/todoist-sdk'
import { z } from 'zod'
import { optionalString } from './schema-helpers.js'

/**
 * Maximum number of reminders per add/update operation.
 */
export const MAX_REMINDERS_PER_OPERATION = 25

/**
 * Shared schema for reminder delivery service (email or push).
 */
export const ReminderServiceSchema = z.enum(REMINDER_DELIVERY_SERVICES)

/**
 * Shared schema for reminder due date input.
 */
export const ReminderDueInputSchema = z.object({
    date: z.string().optional().describe('Due date in YYYY-MM-DD format.'),
    string: z.string().optional().describe('Natural language due string, e.g. "tomorrow at 3pm".'),
    timezone: z.string().optional().describe('Timezone for the reminder, e.g. "America/New_York".'),
    lang: z.string().optional().describe('Language for parsing the due string, e.g. "en".'),
})

/**
 * Shared schema for location trigger (on_enter or on_leave).
 */
export const LocationTriggerSchema = z.enum(LOCATION_TRIGGERS)

/**
 * Shared schema for the isUrgent flag on time-based reminders (relative and absolute).
 */
export const ReminderIsUrgentSchema = z
    .boolean()
    .optional()
    .describe('Whether this is an urgent reminder. Applies to relative and absolute reminders.')

const NOTIFY_USER_DESCRIPTION =
    'Who to remind: user ID, email, name, or "me". Must collaborate on the task\'s project.'

/**
 * Shared schema for who receives a new reminder. Without it, Todoist reminds the user creating it.
 */
export const ReminderNotifyUserSchema = optionalString(
    `${NOTIFY_USER_DESCRIPTION} Defaults to the creator.`,
)

/**
 * Shared schema for a new recipient of an existing reminder. Without it, the recipient is kept.
 */
export const ReminderNotifyUserUpdateSchema = optionalString(
    `${NOTIFY_USER_DESCRIPTION} Omit to keep the current one.`,
)
