import {
    HEALTH_STATUSES,
    type ProjectHealth,
    type ProjectHealthContext,
    type ProjectProgress,
    type TodoistApi,
} from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    projectId: z.string().min(1).describe('The ID of the project to check health for.'),
    includeContext: z
        .boolean()
        .default(false)
        .describe(
            'Include detailed health context with project metrics and task-level data. May produce large output for projects with many tasks.',
        ),
}

const TaskContextOutputSchema = z.object({
    id: z.string().describe('The task ID.'),
    content: z.string().describe('The task content/title.'),
    priority: z.string().describe('The task priority (1-4).'),
    due: z.string().optional().describe('The due date string, if set.'),
    deadline: z.string().optional().describe('The deadline date string, if set.'),
    isCompleted: z.boolean().describe('Whether the task is completed.'),
    labels: z.array(z.string()).describe('Labels applied to this task.'),
})

const OutputSchema = {
    projectId: z.string().describe('The project ID.'),
    projectName: z.string().describe('The project name.'),
    progress: z
        .object({
            completedCount: z.number().describe('Number of completed tasks.'),
            activeCount: z.number().describe('Number of active (incomplete) tasks.'),
            progressPercent: z.number().describe('Completion percentage (0-100).'),
        })
        .describe('Project completion progress.'),
    health: z
        .object({
            status: z.enum(HEALTH_STATUSES).describe('The overall health status of the project.'),
            description: z
                .string()
                .optional()
                .describe('Detailed description of the health assessment.'),
            descriptionSummary: z
                .string()
                .optional()
                .describe('Brief summary of the health assessment.'),
            isStale: z
                .boolean()
                .describe('Whether the health data is stale and may need refreshing.'),
            updateInProgress: z
                .boolean()
                .describe('Whether a health analysis update is currently in progress.'),
            updatedAt: z
                .string()
                .optional()
                .describe('When the health assessment was last updated.'),
        })
        .describe('Project health assessment.'),
    context: z
        .object({
            projectDescription: z.string().optional().describe('The project description, if any.'),
            projectMetrics: z
                .object({
                    totalTasks: z.number().describe('Total number of tasks in the project.'),
                    completedTasks: z.number().describe('Number of completed tasks.'),
                    overdueTasks: z.number().describe('Number of overdue tasks.'),
                    tasksCreatedThisWeek: z.number().describe('Tasks created in the current week.'),
                    tasksCompletedThisWeek: z
                        .number()
                        .describe('Tasks completed in the current week.'),
                    averageCompletionTime: z
                        .number()
                        .optional()
                        .describe('Average task completion time in days, if available.'),
                })
                .describe('Aggregated project metrics.'),
            tasks: z.array(TaskContextOutputSchema).describe('Tasks in the project.'),
        })
        .optional()
        .describe(
            'Detailed project context with metrics and task data. Only included when includeContext is true.',
        ),
}

type HealthData = {
    progress: ProjectProgress
    health: ProjectHealth
    context?: ProjectHealthContext
}

async function fetchHealthData(
    client: TodoistApi,
    projectId: string,
    includeContext: boolean,
): Promise<HealthData> {
    if (includeContext) {
        const [progress, health, context] = await Promise.all([
            client.getProjectProgress(projectId),
            client.getProjectHealth(projectId),
            client.getProjectHealthContext(projectId),
        ])
        return { progress, health, context }
    }

    const [progress, health] = await Promise.all([
        client.getProjectProgress(projectId),
        client.getProjectHealth(projectId),
    ])
    return { progress, health }
}

function generateTextContent(
    projectName: string,
    { progress, health, context }: HealthData,
): string {
    const lines: string[] = [`# Project Health: ${projectName}`, '']

    // Health status
    lines.push(`**Status:** ${health.status}`)
    if (health.isStale) {
        lines.push('**Note:** Health data is stale and may not reflect recent changes.')
    }
    if (health.updateInProgress) {
        lines.push('**Note:** A health analysis update is currently in progress.')
    }
    if (health.updatedAt) {
        lines.push(`**Last Updated:** ${health.updatedAt.toISOString()}`)
    }

    // Progress
    lines.push('')
    lines.push('## Progress')
    lines.push(
        `**Completed:** ${progress.completedCount} | **Active:** ${progress.activeCount} | **Progress:** ${progress.progressPercent}%`,
    )

    // Description
    if (health.description) {
        lines.push('')
        lines.push('## Health Description')
        lines.push(health.description)
    }

    // Context (if included)
    if (context) {
        lines.push('')
        lines.push('## Project Metrics')
        const m = context.projectMetrics
        lines.push(`- **Total Tasks:** ${m.totalTasks}`)
        lines.push(`- **Completed:** ${m.completedTasks}`)
        lines.push(`- **Overdue:** ${m.overdueTasks}`)
        lines.push(`- **Created This Week:** ${m.tasksCreatedThisWeek}`)
        lines.push(`- **Completed This Week:** ${m.tasksCompletedThisWeek}`)
        if (m.averageCompletionTime !== null) {
            lines.push(`- **Avg Completion Time:** ${m.averageCompletionTime} days`)
        }

        if (context.tasks.length > 0) {
            lines.push('')
            lines.push(`## Tasks (${context.tasks.length})`)
            for (const task of context.tasks) {
                const parts = [`id=${task.id}`, task.content]
                if (task.due) parts.push(`due=${task.due}`)
                if (task.deadline) parts.push(`deadline=${task.deadline}`)
                if (task.isCompleted) parts.push('(completed)')
                lines.push(`- ${parts.join('; ')}`)
            }
        }
    }

    return lines.join('\n')
}

const getProjectHealth = {
    name: ToolNames.GET_PROJECT_HEALTH,
    description:
        'Get a comprehensive health assessment for a project including completion progress, health status (EXCELLENT, ON_TRACK, AT_RISK, CRITICAL), and optional detailed context with project metrics and task-level data. Use includeContext=true for that full detail.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
    },
    async execute(args, client) {
        const { projectId, includeContext } = args

        const data = await fetchHealthData(client, projectId, includeContext)

        // Get project name from context if available, otherwise from health context or progress
        const projectName = data.context?.projectName ?? `Project ${projectId}`

        const textContent = generateTextContent(projectName, data)

        const context = data.context
            ? {
                  projectDescription: data.context.projectDescription ?? undefined,
                  projectMetrics: {
                      ...data.context.projectMetrics,
                      averageCompletionTime:
                          data.context.projectMetrics.averageCompletionTime ?? undefined,
                  },
                  tasks: data.context.tasks.map((task) => ({
                      id: task.id,
                      content: task.content,
                      priority: task.priority,
                      due: task.due ?? undefined,
                      deadline: task.deadline ?? undefined,
                      isCompleted: task.isCompleted,
                      labels: task.labels,
                  })),
              }
            : undefined

        return {
            textContent,
            structuredContent: {
                projectId,
                projectName,
                progress: {
                    completedCount: data.progress.completedCount,
                    activeCount: data.progress.activeCount,
                    progressPercent: data.progress.progressPercent,
                },
                health: {
                    status: data.health.status,
                    description: data.health.description ?? undefined,
                    descriptionSummary: data.health.descriptionSummary ?? undefined,
                    isStale: data.health.isStale,
                    updateInProgress: data.health.updateInProgress,
                    updatedAt: data.health.updatedAt?.toISOString(),
                },
                context,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { getProjectHealth }
