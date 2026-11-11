import type { TodoistApi } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { getDateString } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {}

const OutputSchema = {
    type: z.literal('user_info').describe('The type of the response.'),
    userId: z.string().describe('The user ID.'),
    fullName: z.string().describe('The full name of the user.'),
    timezone: z.string().describe('The timezone of the user.'),
    currentLocalTime: z.string().describe('The current local time of the user.'),
    startDay: z.number().describe('The start day of the week (1 = Monday, 7 = Sunday).'),
    startDayName: z.string().describe('The name of the start day.'),
    weekStartDate: z.string().describe('The start date of the current week (YYYY-MM-DD).'),
    weekEndDate: z.string().describe('The end date of the current week (YYYY-MM-DD).'),
    currentWeekNumber: z.number().describe('The current week number of the year.'),
    completedToday: z.number().describe('The number of tasks completed today.'),
    dailyGoal: z.number().describe('The daily goal for task completions.'),
    weeklyGoal: z.number().describe('The weekly goal for task completions.'),
    email: z.string().describe('The email address of the user.'),
    plan: z.enum(['Todoist Free', 'Todoist Pro', 'Todoist Business']).describe('The user plan.'),
}

type UserPlan = 'Todoist Free' | 'Todoist Pro' | 'Todoist Business'

type UserInfoStructured = Record<string, unknown> & {
    type: 'user_info'
    userId: string
    fullName: string
    timezone: string
    currentLocalTime: string
    startDay: number
    startDayName: string
    weekStartDate: string
    weekEndDate: string
    currentWeekNumber: number
    completedToday: number
    dailyGoal: number
    weeklyGoal: number
    email: string
    plan: UserPlan
}

function getUserPlan(user: { isPremium: boolean; businessAccountId?: string | null }): UserPlan {
    if (user.businessAccountId) {
        return 'Todoist Business'
    }
    if (user.isPremium) {
        return 'Todoist Pro'
    }
    return 'Todoist Free'
}

// Helper functions for date and time calculations
function getWeekStartDate(date: Date, startDay: number): Date {
    const currentDay = date.getDay() || 7 // Convert Sunday (0) to 7 for ISO format
    const daysFromStart = (currentDay - startDay + 7) % 7
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - daysFromStart)
    return weekStart
}

function getWeekEndDate(weekStart: Date): Date {
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    return weekEnd
}

function getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1)
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7)
}

function getDayName(dayNumber: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    // Convert ISO day number (1=Monday, 7=Sunday) to array index (0=Sunday, 6=Saturday)
    const index = dayNumber === 7 ? 0 : dayNumber
    return days[index] ?? 'Unknown'
}

function isValidTimezone(timezone: string): boolean {
    try {
        // Test if the timezone is valid by attempting to format a date with it
        new Intl.DateTimeFormat('en-US', { timeZone: timezone })
        return true
    } catch {
        return false
    }
}

function getSafeTimezone(timezone: string): string {
    return isValidTimezone(timezone) ? timezone : 'UTC'
}

function formatLocalTime(date: Date, timezone: string): string {
    const safeTimezone = getSafeTimezone(timezone)
    return date.toLocaleString('en-US', {
        timeZone: safeTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
}

async function generateUserInfo(
    client: TodoistApi,
): Promise<{ textContent: string; structuredContent: UserInfoStructured }> {
    // Get user information from Todoist API
    const user = await client.getUser()

    // Parse timezone from user data and ensure it's valid
    const rawTimezone = user.tzInfo?.timezone ?? 'UTC'
    const timezone = getSafeTimezone(rawTimezone)

    // Get current time in user's timezone
    const now = new Date()
    const localTime = formatLocalTime(now, timezone)

    // Calculate week information based on user's start day
    const startDay = user.startDay ?? 1 // Default to Monday if not set
    const startDayName = getDayName(startDay)

    // Determine user's plan
    const plan = getUserPlan(user)

    // Create a date object in user's timezone for accurate week calculations
    const userDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    const weekStart = getWeekStartDate(userDate, startDay)
    const weekEnd = getWeekEndDate(weekStart)
    const weekNumber = getWeekNumber(userDate)

    // Generate markdown text content
    const lines: string[] = [
        '# User Information',
        '',
        `**User ID:** ${user.id}`,
        `**Full Name:** ${user.fullName}`,
        `**Email:** ${user.email}`,
        `**Timezone:** ${timezone}`,
        `**Current Local Time:** ${localTime}`,
        '',
        '## Week Settings',
        `**Week Start Day:** ${startDayName} (${startDay})`,
        `**Current Week:** Week ${weekNumber}`,
        `**Week Start Date:** ${getDateString(weekStart)}`,
        `**Week End Date:** ${getDateString(weekEnd)}`,
        '',
        '## Daily Progress',
        `**Completed Today:** ${user.completedToday}`,
        `**Daily Goal:** ${user.dailyGoal}`,
        `**Weekly Goal:** ${user.weeklyGoal}`,
        '',
        '## Account Info',
        `**Plan:** ${plan}`,
    ]

    const textContent = lines.join('\n')

    // Generate structured content
    const structuredContent: UserInfoStructured = {
        type: 'user_info',
        userId: user.id,
        fullName: user.fullName,
        timezone: timezone,
        currentLocalTime: localTime,
        startDay: startDay,
        startDayName: startDayName,
        weekStartDate: getDateString(weekStart),
        weekEndDate: getDateString(weekEnd),
        currentWeekNumber: weekNumber,
        completedToday: user.completedToday,
        dailyGoal: user.dailyGoal,
        weeklyGoal: user.weeklyGoal,
        email: user.email,
        plan: plan,
    }

    return { textContent, structuredContent }
}

const userInfo = {
    name: ToolNames.USER_INFO,
    description:
        'Get comprehensive user information including user ID, full name, email, timezone with current local time, week start day preferences, current week dates, daily/weekly goal progress, and user plan (Free/Pro/Business).',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(_args, client) {
        const result = await generateUserInfo(client)

        return {
            textContent: result.textContent,
            structuredContent: result.structuredContent,
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { type UserInfoStructured, userInfo }
