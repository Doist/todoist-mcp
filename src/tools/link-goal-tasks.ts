import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { FailureSchema } from '../utils/output-schemas.js'
import { summarizeBatch } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const MAX_TASKS_PER_OPERATION = 50

const ArgsSchema = {
    goalId: z.string().min(1).describe('The ID of the goal.'),
    taskIds: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_TASKS_PER_OPERATION)
        .describe(`The IDs of the tasks to link or unlink (max ${MAX_TASKS_PER_OPERATION}).`),
    action: z.enum(['link', 'unlink']).describe('Whether to link or unlink the tasks.'),
}

const OutputSchema = {
    processed: z.array(z.string()).describe('The IDs of successfully processed tasks.'),
    failures: z.array(FailureSchema).describe('Failed operations with error details.'),
    totalRequested: z.number().describe('The total number of tasks requested.'),
    successCount: z.number().describe('The number of successfully processed tasks.'),
    failureCount: z.number().describe('The number of failed operations.'),
}

const linkGoalTasks = {
    name: ToolNames.LINK_GOAL_TASKS,
    description: 'Link or unlink tasks to/from a goal.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const settled = await Promise.allSettled(
            args.taskIds.map(async (taskId) => {
                if (args.action === 'link') {
                    await client.linkTaskToGoal({ goalId: args.goalId, taskId })
                } else {
                    await client.unlinkTaskFromGoal({ goalId: args.goalId, taskId })
                }
                return taskId
            }),
        )

        const processed: string[] = []
        const failures: Array<{ item: string; error: string; code?: string }> = []
        settled.forEach((result, index) => {
            const taskId = args.taskIds[index] as string
            if (result.status === 'fulfilled') {
                processed.push(taskId)
            } else {
                const errorMessage =
                    result.reason instanceof Error ? result.reason.message : 'Unknown error'
                failures.push({ item: taskId, error: errorMessage })
            }
        })

        const actionLabel =
            args.action === 'link' ? 'Linked tasks to goal' : 'Unlinked tasks from goal'
        const textContent = summarizeBatch({
            action: actionLabel,
            success: processed.length,
            total: args.taskIds.length,
            successItems: processed,
            failures,
        })

        return {
            textContent,
            structuredContent: {
                processed,
                failures,
                totalRequested: args.taskIds.length,
                successCount: processed.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { linkGoalTasks, MAX_TASKS_PER_OPERATION }
