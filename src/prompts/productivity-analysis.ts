import type { GetPromptResult } from '@modelcontextprotocol/server'
import { z } from 'zod'

const argsSchema = z.object({
    period: z
        .enum(['today', '7d', '14d', '30d', 'this-week', 'this-month'])
        .default('7d')
        .describe(
            'Time period for the analysis. "today" analyzes the current day, "7d"/"14d"/"30d" analyze the last N days, "this-week" and "this-month" analyze the current week or month.',
        ),
    focus: z
        .enum(['overall', 'goals', 'projects', 'trends', 'recommendations'])
        .default('overall')
        .describe(
            'Focus area for the analysis. "overall" provides a comprehensive report covering all areas. Other values focus on a specific aspect.',
        ),
    projectId: z
        .string()
        .optional()
        .describe('Optional project ID to scope the analysis to a specific project.'),
})

type PromptArgs = z.infer<typeof argsSchema>

/**
 * Compute the date range (since/until as YYYY-MM-DD) for a given period.
 * Uses UTC since the prompt instructs the LLM to call user-info for timezone.
 */
function computeDateRange(
    period: PromptArgs['period'],
    now: Date = new Date(),
): { since: string; until: string; periodDescription: string } {
    const formatDate = (d: Date): string => d.toISOString().slice(0, 10)
    const until = formatDate(now)

    switch (period) {
        case 'today':
            return { since: until, until, periodDescription: 'today' }

        case '7d': {
            const since = new Date(now)
            since.setDate(since.getDate() - 6)
            return {
                since: formatDate(since),
                until,
                periodDescription: 'the last 7 days',
            }
        }

        case '14d': {
            const since = new Date(now)
            since.setDate(since.getDate() - 13)
            return {
                since: formatDate(since),
                until,
                periodDescription: 'the last 14 days',
            }
        }

        case '30d': {
            const since = new Date(now)
            since.setDate(since.getDate() - 29)
            return {
                since: formatDate(since),
                until,
                periodDescription: 'the last 30 days',
            }
        }

        case 'this-week': {
            const dayOfWeek = now.getUTCDay()
            const monday = new Date(now)
            monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7))
            return {
                since: formatDate(monday),
                until,
                periodDescription: 'this week (Monday to today)',
            }
        }

        case 'this-month': {
            const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
            return {
                since: formatDate(firstOfMonth),
                until,
                periodDescription: 'this month',
            }
        }
    }
}

function buildFocusSections(focus: PromptArgs['focus']): string {
    const sections: Record<string, string> = {
        goals: `### Goal Tracking
- Compare tasks completed today vs the daily goal
- Calculate progress toward the weekly goal (using daysItems to sum completions for the current week)
- Report on the current daily and weekly streaks — how long they've been going, and how they compare to the user's best streaks
- Flag if the user is at risk of breaking a streak`,

        trends: `### Completion Trends
- Show a day-by-day breakdown of tasks completed over the period
- Identify peak productivity days and low-activity days
- Note any patterns (e.g., weekday vs weekend, specific days that are consistently high or low)
- Compare weekly totals if multiple weeks are in the period`,

        projects: `### Project Distribution
- Break down completions by project (using per-project data from daysItems/weekItems)
- Identify which projects received the most and least attention
- Highlight any projects with zero completions in the period
- If a specific project was requested, focus the analysis on that project's performance`,

        recommendations: `### Karma & Momentum
- Report the current karma score and trend
- Summarize recent karma changes and their reasons

### Recommendations
- Based on all the data gathered, provide 3-5 specific, actionable suggestions
- Address any concerning patterns (declining completions, broken streaks, neglected projects)
- Suggest concrete next steps (e.g., "Focus on Project X which has had no completions this week")
- If goals seem too easy or too hard based on actual completion rates, suggest adjustments`,
    }

    if (focus === 'overall') {
        return Object.values(sections).join('\n\n')
    }

    return sections[focus] ?? ''
}

function buildPromptText(args: PromptArgs): string {
    const { since, until, periodDescription } = computeDateRange(args.period)
    const projectScope = args.projectId
        ? `\nScope this analysis to project ID: ${args.projectId}. Pass this projectId when calling find-completed-tasks and get-overview.`
        : ''

    return `Analyze my Todoist productivity for ${periodDescription} (${since} to ${until}).${projectScope}

## Instructions

Follow these steps to gather data and produce the analysis:

### Step 1: Gather Data

Call the following tools to collect the necessary data:

1. **user-info** — Get my timezone, daily/weekly goals, tasks completed today, and user ID (you'll need the user ID for the responsibleUser filter)
2. **get-productivity-stats** — Get streak data, karma score/trend, daily and weekly completion breakdowns, and karma history
3. **find-completed-tasks** — Get completed tasks for the period (since: "${since}", until: "${until}"). Set responsibleUser to my user ID (from user-info) to see only my completions${args.projectId ? `. Set projectId to "${args.projectId}"` : ''}
${args.focus === 'overall' || args.focus === 'projects' ? `4. **get-overview** — Get the project structure${args.projectId ? ` for project "${args.projectId}"` : ''} to provide context for the analysis` : ''}

### Step 2: Analyze

Using the collected data, produce an analysis covering the following sections:

${buildFocusSections(args.focus)}

### Step 3: Format

Present the analysis as a clear, well-structured markdown report with:
- A summary header with the period and key headline metrics
- Each analytical section with its own header
- Specific numbers and comparisons (not vague statements)
- Actionable takeaways highlighted clearly`
}

function callback(args: PromptArgs): GetPromptResult {
    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: buildPromptText(args),
                },
            },
        ],
    }
}

const productivityAnalysis = {
    name: 'productivity-analysis',
    title: 'Productivity Analysis',
    description:
        'Analyze your Todoist productivity with insights on completion trends, goal streaks, project distribution, and actionable recommendations. Gathers data from multiple tools and synthesizes a comprehensive report.',
    argsSchema,
    callback,
}

export { buildPromptText, computeDateRange, productivityAnalysis }
