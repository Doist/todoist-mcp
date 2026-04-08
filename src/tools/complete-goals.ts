import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { FailureSchema } from '../utils/output-schemas.js'
import { summarizeBatch } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    ids: z
        .array(z.string().min(1))
        .min(1)
        .describe('The IDs of the goals to complete or uncomplete.'),
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
        const processed: string[] = []
        const failures: Array<{ item: string; error: string; code?: string }> = []

        for (const id of args.ids) {
            try {
                if (args.action === 'complete') {
                    await client.completeGoal(id)
                } else {
                    await client.uncompleteGoal(id)
                }
                processed.push(id)
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                failures.push({ item: id, error: errorMessage })
            }
        }

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

export { completeGoals }
