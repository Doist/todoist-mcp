import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { GoalSchema as GoalOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const GoalInputSchema = z.object({
    name: z.string().min(1).describe('The name of the goal.'),
    workspaceId: z
        .string()
        .optional()
        .describe(
            'Workspace ID. If provided, creates a workspace goal. If omitted, creates a personal goal.',
        ),
    description: z.string().optional().describe('The description of the goal.'),
    deadline: z.string().optional().describe('The target date (YYYY-MM-DD).'),
    responsibleUid: z.string().optional().describe('The user ID responsible for this goal.'),
})

const ArgsSchema = {
    goals: z.array(GoalInputSchema).min(1).describe('The array of goals to create.'),
}

const OutputSchema = {
    goals: z.array(GoalOutputSchema).describe('The created goals.'),
    totalCount: z.number().describe('The total number of goals created.'),
}

const addGoals = {
    name: ToolNames.ADD_GOALS,
    description: 'Create one or more goals. Omit workspaceId for personal goals.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ goals }, client) {
        const newGoals = await Promise.all(goals.map((goal) => client.addGoal(goal)))

        const count = newGoals.length
        const goalList = newGoals
            .map((g) => `• ${g.name} (id=${g.id}, owner=${g.ownerType})`)
            .join('\n')
        const textContent = `Added ${count} goal${count === 1 ? '' : 's'}:\n${goalList}`

        return {
            textContent,
            structuredContent: {
                goals: newGoals,
                totalCount: newGoals.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { addGoals }
