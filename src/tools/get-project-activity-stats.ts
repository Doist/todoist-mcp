import type { ProjectActivityStats } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    projectId: z.string().min(1).describe('The ID of the project to get activity stats for.'),
    weeks: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe('Number of weeks of activity data to retrieve (1-12, default 2).'),
    includeWeeklyCounts: z
        .boolean()
        .optional()
        .describe('Include weekly rollup counts alongside daily counts.'),
}

const OutputSchema = {
    projectId: z.string().describe('The project ID.'),
    dayItems: z
        .array(
            z.object({
                date: z.string().describe('Date in ISO format.'),
                totalCount: z.number().describe('Number of tasks completed on this day.'),
            }),
        )
        .describe('Daily task completion counts.'),
    weekItems: z
        .array(
            z.object({
                fromDate: z.string().describe('Start date of the week.'),
                toDate: z.string().describe('End date of the week.'),
                totalCount: z.number().describe('Number of tasks completed in this week.'),
            }),
        )
        .optional()
        .describe('Weekly completion rollups. Only included when includeWeeklyCounts is true.'),
}

function generateTextContent(projectId: string, stats: ProjectActivityStats): string {
    const lines: string[] = [`# Activity Stats: Project ${projectId}`, '']

    if (stats.dayItems.length > 0) {
        lines.push('## Daily Activity')
        for (const day of stats.dayItems) {
            lines.push(`- ${day.date}: ${day.totalCount} completed`)
        }
    } else {
        lines.push('No daily activity data available.')
    }

    if (stats.weekItems && stats.weekItems.length > 0) {
        lines.push('')
        lines.push('## Weekly Activity')
        for (const week of stats.weekItems) {
            lines.push(`- ${week.fromDate} to ${week.toDate}: ${week.totalCount} completed`)
        }
    }

    return lines.join('\n')
}

const getProjectActivityStats = {
    name: ToolNames.GET_PROJECT_ACTIVITY_STATS,
    description:
        'Get daily and optional weekly task completion counts for a project over a configurable time window (1-12 weeks). Useful for identifying completion trends and patterns.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
    },
    async execute(args, client) {
        const { projectId, weeks, includeWeeklyCounts } = args

        const stats = await client.getProjectActivityStats(projectId, {
            weeks,
            includeWeeklyCounts,
        })

        const textContent = generateTextContent(projectId, stats)

        return {
            textContent,
            structuredContent: {
                projectId,
                dayItems: stats.dayItems,
                weekItems: stats.weekItems ?? undefined,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { getProjectActivityStats }
