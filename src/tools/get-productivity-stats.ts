import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {}

const StreakSchema = z.object({
    count: z.number().describe('Number of consecutive periods in this streak.'),
    start: z.string().describe('Start date of the streak.'),
    end: z.string().describe('End date of the streak.'),
})

const ProjectCompletionSchema = z.object({
    id: z.string().describe('Project ID.'),
    completed: z.number().describe('Number of tasks completed in this project.'),
})

const OutputSchema = {
    completedCount: z.number().describe('Total number of completed tasks (all-time).'),
    daysItems: z
        .array(
            z.object({
                date: z.string().describe('Date string (YYYY-MM-DD).'),
                totalCompleted: z.number().describe('Total tasks completed on this day.'),
                items: z
                    .array(ProjectCompletionSchema)
                    .describe('Per-project completion breakdown for this day.'),
            }),
        )
        .describe('Daily completion breakdown (most recent days).'),
    weekItems: z
        .array(
            z.object({
                from: z.string().describe('Start date of the week.'),
                to: z.string().describe('End date of the week.'),
                totalCompleted: z.number().describe('Total tasks completed in this week.'),
                items: z
                    .array(ProjectCompletionSchema)
                    .describe('Per-project completion breakdown for this week.'),
            }),
        )
        .describe('Weekly completion breakdown (most recent weeks).'),
    goals: z
        .object({
            dailyGoal: z.number().describe('Daily task completion goal.'),
            weeklyGoal: z.number().describe('Weekly task completion goal.'),
            currentDailyStreak: StreakSchema.describe('Current daily goal streak.'),
            currentWeeklyStreak: StreakSchema.describe('Current weekly goal streak.'),
            lastDailyStreak: StreakSchema.describe('Previous daily goal streak.'),
            lastWeeklyStreak: StreakSchema.describe('Previous weekly goal streak.'),
            maxDailyStreak: StreakSchema.describe('Best daily goal streak ever.'),
            maxWeeklyStreak: StreakSchema.describe('Best weekly goal streak ever.'),
            vacationMode: z.boolean().describe('Whether vacation mode is enabled.'),
            karmaDisabled: z.boolean().describe('Whether karma tracking is disabled.'),
        })
        .describe('Goal and streak information.'),
    karma: z.number().describe('Current karma score.'),
    karmaTrend: z.string().describe('Karma trend direction (e.g., "up" or "down").'),
    karmaLastUpdate: z.number().describe('Timestamp of the last karma update.'),
    karmaGraphData: z
        .array(
            z.object({
                date: z.string().describe('Date of the karma data point.'),
                karmaAvg: z.number().describe('Average karma for this date.'),
            }),
        )
        .describe('Historical karma data points for graphing.'),
    karmaUpdateReasons: z
        .array(
            z.object({
                time: z.string().describe('Timestamp of the karma change.'),
                newKarma: z.number().describe('New karma value after the change.'),
                positiveKarma: z.number().describe('Positive karma earned.'),
                negativeKarma: z.number().describe('Negative karma incurred.'),
                positiveKarmaReasons: z.array(z.any()).describe('Reasons for positive karma.'),
                negativeKarmaReasons: z.array(z.any()).describe('Reasons for negative karma.'),
            }),
        )
        .describe('Recent karma change events with reasons.'),
    projectColors: z.record(z.string(), z.string()).describe('Map of project ID to color key.'),
}

const getProductivityStats = {
    name: ToolNames.GET_PRODUCTIVITY_STATS,
    description:
        'Get comprehensive productivity statistics including daily/weekly completion breakdowns, goal streaks (current, last, max), karma score and trends, and historical karma data. Useful for productivity analysis and tracking goal progress. Reports counts, streaks and karma only, never the tasks themselves — for "what did I complete", use find-activity.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
    },
    async execute(_args, client) {
        const stats = await client.getProductivityStats()

        const textContent = generateTextContent(stats)

        return {
            textContent,
            structuredContent: {
                completedCount: stats.completedCount,
                daysItems: stats.daysItems,
                weekItems: stats.weekItems,
                goals: {
                    dailyGoal: stats.goals.dailyGoal,
                    weeklyGoal: stats.goals.weeklyGoal,
                    currentDailyStreak: stats.goals.currentDailyStreak,
                    currentWeeklyStreak: stats.goals.currentWeeklyStreak,
                    lastDailyStreak: stats.goals.lastDailyStreak,
                    lastWeeklyStreak: stats.goals.lastWeeklyStreak,
                    maxDailyStreak: stats.goals.maxDailyStreak,
                    maxWeeklyStreak: stats.goals.maxWeeklyStreak,
                    vacationMode: stats.goals.vacationMode,
                    karmaDisabled: stats.goals.karmaDisabled,
                },
                karma: stats.karma,
                karmaTrend: stats.karmaTrend,
                karmaLastUpdate: stats.karmaLastUpdate,
                karmaGraphData: stats.karmaGraphData,
                karmaUpdateReasons: stats.karmaUpdateReasons,
                projectColors: stats.projectColors,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent(
    stats: Awaited<
        ReturnType<typeof import('@doist/todoist-sdk').TodoistApi.prototype.getProductivityStats>
    >,
): string {
    const lines: string[] = [
        '# Productivity Statistics',
        '',
        `**Total Completed Tasks:** ${stats.completedCount.toLocaleString()}`,
        `**Karma:** ${stats.karma.toLocaleString()} (${stats.karmaTrend})`,
        '',
        '## Goals & Streaks',
        `**Daily Goal:** ${stats.goals.dailyGoal} tasks/day`,
        `**Weekly Goal:** ${stats.goals.weeklyGoal} tasks/week`,
        `**Current Daily Streak:** ${stats.goals.currentDailyStreak.count} days (${stats.goals.currentDailyStreak.start} to ${stats.goals.currentDailyStreak.end})`,
        `**Current Weekly Streak:** ${stats.goals.currentWeeklyStreak.count} weeks (${stats.goals.currentWeeklyStreak.start} to ${stats.goals.currentWeeklyStreak.end})`,
        `**Best Daily Streak:** ${stats.goals.maxDailyStreak.count} days`,
        `**Best Weekly Streak:** ${stats.goals.maxWeeklyStreak.count} weeks`,
    ]

    if (stats.daysItems.length > 0) {
        lines.push('', '## Recent Daily Completions')
        const recentDays = stats.daysItems.slice(0, 7)
        for (const day of recentDays) {
            lines.push(`  ${day.date}: ${day.totalCompleted} tasks`)
        }
    }

    if (stats.weekItems.length > 0) {
        lines.push('', '## Recent Weekly Completions')
        const recentWeeks = stats.weekItems.slice(0, 4)
        for (const week of recentWeeks) {
            lines.push(`  ${week.from} to ${week.to}: ${week.totalCompleted} tasks`)
        }
    }

    return lines.join('\n')
}

export { getProductivityStats }
