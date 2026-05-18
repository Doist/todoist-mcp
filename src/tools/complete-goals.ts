import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { FailureSchema } from '../utils/output-schemas.js'
import { summarizeBatch } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const MAX_GOALS_PER_OPERATION = 25

const ArgsSchema = {
    ids: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_GOALS_PER_OPERATION)
        .describe(
            `The IDs of the goals to complete or uncomplete (max ${MAX_GOALS_PER_OPERATION}).`,
        ),
    action: z
        .enum(['complete', 'uncomplete'])
        .describe('Whether to complete or uncomplete the goals.'),
}

const OutputSchema = {
    processed: z.array(z.string()).describe('The IDs of successfully processed goals.'),
    failures: z.array(FailureSchema).describe('Failed operations with error details.'),
    totalRequested: z.number().describe('The total number of goals requested.'),
    successCount: z.number().describe('The number of successfully processed goals.'),
    failureCount: z.number().describe('The number of failed operations.'),
}

const completeGoals = {
    name: ToolNames.COMPLETE_GOALS,
    description: 'Complete or uncomplete one or more goals by their IDs.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute(args, client) {
        const settled = await Promise.allSettled(
            args.ids.map(async (id) => {
                if (args.action === 'complete') {
                    await client.completeGoal(id)
                } else {
                    await client.uncompleteGoal(id)
                }
                return id
            }),
        )

        const processed: string[] = []
        const failures: Array<{ item: string; error: string; code?: string }> = []
        settled.forEach((result, index) => {
            const id = args.ids[index] as string
            if (result.status === 'fulfilled') {
                processed.push(id)
            } else {
                const errorMessage =
                    result.reason instanceof Error ? result.reason.message : 'Unknown error'
                failures.push({ item: id, error: errorMessage })
            }
        })

        const actionLabel = args.action === 'complete' ? 'Completed goals' : 'Reopened goals'
        const textContent = summarizeBatch({
            action: actionLabel,
            success: processed.length,
            total: args.ids.length,
            successItems: processed,
            failures,
        })

        return {
            textContent,
            structuredContent: {
                processed,
                failures,
                totalRequested: args.ids.length,
                successCount: processed.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { completeGoals, MAX_GOALS_PER_OPERATION }
