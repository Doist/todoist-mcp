import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { formatBatchItemError } from '../tool-execution-error.js'
import { logBatchFailures } from '../utils/batch-failures.js'
import { FailureSchema } from '../utils/output-schemas.js'
import { summarizeBatch } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    ids: z.array(z.string().min(1)).min(1).describe('The IDs of the tasks to uncomplete.'),
}

const OutputSchema = {
    uncompleted: z.array(z.string()).describe('The IDs of successfully uncompleted tasks.'),
    failures: z.array(FailureSchema).describe('Failed task uncompletion with error details.'),
    totalRequested: z.number().describe('The total number of tasks requested to uncomplete.'),
    successCount: z.number().describe('The number of successfully uncompleted tasks.'),
    failureCount: z.number().describe('The number of failed task uncompletions.'),
}

const uncompleteTasks = {
    name: ToolNames.UNCOMPLETE_TASKS,
    description: 'Uncomplete (reopen) one or more completed tasks by their IDs.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute(args, client) {
        const uncompleted: string[] = []
        const failures: Array<{ item: string; error: string; code?: string }> = []

        for (const id of args.ids) {
            try {
                await client.reopenTask(id)
                uncompleted.push(id)
            } catch (error) {
                // `formatBatchItemError` keeps the status and error tag, so a
                // quota rejection stays distinguishable from a missing task
                // once the failures are aggregated.
                failures.push({
                    item: id,
                    error: formatBatchItemError(error),
                })
            }
        }

        logBatchFailures(ToolNames.UNCOMPLETE_TASKS, args.ids.length, failures)

        const textContent = generateTextContent({
            uncompleted,
            failures,
            args,
        })

        return {
            textContent,
            structuredContent: {
                uncompleted,
                failures,
                totalRequested: args.ids.length,
                successCount: uncompleted.length,
                failureCount: failures.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    uncompleted,
    failures,
    args,
}: {
    uncompleted: string[]
    failures: Array<{ item: string; error: string; code?: string }>
    args: z.infer<z.ZodObject<typeof ArgsSchema>>
}) {
    return summarizeBatch({
        action: 'Uncompleted tasks',
        success: uncompleted.length,
        total: args.ids.length,
        successItems: uncompleted,
        successLabel: 'Reopened',
        failures,
    })
}

export { uncompleteTasks }
