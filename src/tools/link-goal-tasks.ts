import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { FailureSchema } from '../utils/output-schemas.js'
import { summarizeBatch } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    goalId: z.string().min(1).describe('The ID of the goal.'),
    taskIds: z.array(z.string().min(1)).min(1).describe('The IDs of the tasks to link or unlink.'),
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
        const processed: string[] = []
        const failures: Array<{ item: string; error: string; code?: string }> = []

        for (const taskId of args.taskIds) {
            try {
                if (args.action === 'link') {
                    await client.linkTaskToGoal({ goalId: args.goalId, taskId })
                } else {
                    await client.unlinkTaskFromGoal({ goalId: args.goalId, taskId })
                }
                processed.push(taskId)
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                failures.push({ item: taskId, error: errorMessage })
            }
        }

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

export { linkGoalTasks }
