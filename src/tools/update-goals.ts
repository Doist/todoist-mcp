import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { GoalSchema as GoalOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const REMOVE_SENTINEL = 'remove'
const UNASSIGN_SENTINEL = 'unassign'

const GoalUpdateSchema = z.object({
    id: z.string().min(1).describe('The ID of the goal to update.'),
    name: z.string().optional().describe('New goal name.'),
    description: z
        .string()
        .optional()
        .describe(`New description. Use "${REMOVE_SENTINEL}" to clear.`),
    deadline: z
        .string()
        .optional()
        .describe(`New deadline (YYYY-MM-DD). Use "${REMOVE_SENTINEL}" to clear.`),
    responsibleUid: z
        .string()
        .optional()
        .describe(`New responsible user ID. Use "${UNASSIGN_SENTINEL}" to clear.`),
})

const ArgsSchema = {
    goals: z.array(GoalUpdateSchema).min(1).describe('The array of goals to update.'),
}

const OutputSchema = {
    goals: z.array(GoalOutputSchema).describe('The updated goals.'),
    totalCount: z.number().describe('The total number of goals updated.'),
}

function mapSentinelToNull(value: string | undefined, sentinel: string): string | null | undefined {
    if (value === sentinel) return null
    return value
}

const updateGoals = {
    name: ToolNames.UPDATE_GOALS,
    description: 'Update one or more goals by their IDs.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async execute({ goals }, client) {
        const updatedGoals = await Promise.all(
            goals.map(({ id, description, deadline, responsibleUid, ...rest }) =>
                client.updateGoal(id, {
                    ...rest,
                    description: mapSentinelToNull(description, REMOVE_SENTINEL),
                    deadline: mapSentinelToNull(deadline, REMOVE_SENTINEL),
                    responsibleUid: mapSentinelToNull(responsibleUid, UNASSIGN_SENTINEL),
                }),
            ),
        )

        const count = updatedGoals.length
        const goalList = updatedGoals.map((g) => `• ${g.name} (id=${g.id})`).join('\n')
        const textContent = `Updated ${count} goal${count === 1 ? '' : 's'}:\n${goalList}`

        return {
            textContent,
            structuredContent: {
                goals: updatedGoals,
                totalCount: updatedGoals.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { updateGoals }
