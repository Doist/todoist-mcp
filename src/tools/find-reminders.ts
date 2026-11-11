import type {
    GetLocationRemindersArgs,
    GetLocationRemindersResponse,
    GetRemindersArgs,
    GetRemindersResponse,
    LocationReminder,
    Reminder,
} from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { countRemindersByType, fetchAllPages, mapReminder } from '../tool-helpers.js'
import { ReminderSchema as ReminderOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    taskId: z
        .string()
        .optional()
        .describe(
            'Find all reminders for a specific task. Returns both time-based and location reminders.',
        ),
    reminderId: z
        .string()
        .optional()
        .describe('Get a specific time-based reminder (relative or absolute) by its ID.'),
    locationReminderId: z
        .string()
        .optional()
        .describe('Get a specific location reminder by its ID.'),
}

const OutputSchema = {
    reminders: z
        .array(ReminderOutputSchema)
        .describe('The found reminders (time-based and location).'),
    searchType: z
        .string()
        .describe('The search type used: "task", "reminder", or "location_reminder".'),
    searchId: z.string().describe('The ID used for the search.'),
    totalCount: z.number().describe('Total reminders in this response.'),
}

const findReminders = {
    name: ToolNames.FIND_REMINDERS,
    description:
        'Find reminders by task ID (returns all reminder types), or get a specific reminder by its ID. Use reminderId for time-based reminders and locationReminderId for location reminders.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { taskId, reminderId, locationReminderId } = args

        // Validate exactly one parameter is provided
        const providedParams = [taskId, reminderId, locationReminderId].filter(Boolean)
        if (providedParams.length === 0) {
            throw new Error('One of taskId, reminderId, or locationReminderId must be provided.')
        }
        if (providedParams.length > 1) {
            throw new Error(
                'Only one of taskId, reminderId, or locationReminderId can be provided at a time.',
            )
        }

        if (reminderId) {
            const reminder = await client.getReminder(reminderId)
            const mapped = mapReminder(reminder)

            return {
                textContent: `Found ${reminder.type} reminder (id=${reminderId})`,
                structuredContent: {
                    reminders: [mapped],
                    searchType: 'reminder',
                    searchId: reminderId,
                    totalCount: 1,
                },
            }
        }

        if (locationReminderId) {
            const reminder = await client.getLocationReminder(locationReminderId)
            const mapped = mapReminder(reminder)

            return {
                textContent: `Found location reminder (id=${locationReminderId})`,
                structuredContent: {
                    reminders: [mapped],
                    searchType: 'location_reminder',
                    searchId: locationReminderId,
                    totalCount: 1,
                },
            }
        }

        if (taskId) {
            // taskId search: fetch both time-based and location reminders in parallel
            const [timeBasedReminders, locationReminders] = await Promise.all([
                fetchAllPages<GetRemindersArgs, GetRemindersResponse, Reminder>({
                    apiMethod: (args) => client.getReminders(args),
                    args: { taskId },
                }),
                fetchAllPages<
                    GetLocationRemindersArgs,
                    GetLocationRemindersResponse,
                    LocationReminder
                >({
                    apiMethod: (args) => client.getLocationReminders(args),
                    args: { taskId },
                }),
            ])

            const allReminders: Reminder[] = [...timeBasedReminders, ...locationReminders]
            const mappedReminders = allReminders.map(mapReminder)

            const textContent = generateTextContent(mappedReminders, taskId)

            return {
                textContent,
                structuredContent: {
                    reminders: mappedReminders,
                    searchType: 'task',
                    searchId: taskId,
                    totalCount: mappedReminders.length,
                },
            }
        }

        throw new Error('One of taskId, reminderId, or locationReminderId must be provided.')
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent(reminders: ReturnType<typeof mapReminder>[], taskId: string): string {
    if (reminders.length === 0) {
        return `No reminders found for task ${taskId}`
    }

    const { timeBasedCount, locationCount } = countRemindersByType(reminders)

    const parts: string[] = []
    if (timeBasedCount > 0) {
        const label = timeBasedCount > 1 ? 'time-based reminders' : 'time-based reminder'
        parts.push(`${timeBasedCount} ${label}`)
    }
    if (locationCount > 0) {
        const label = locationCount > 1 ? 'location reminders' : 'location reminder'
        parts.push(`${locationCount} ${label}`)
    }

    return `Found ${parts.join(' and ')} for task ${taskId}`
}

export { findReminders }
