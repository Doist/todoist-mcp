import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapGoal } from '../tool-helpers.js'
import { GoalSchema as GoalOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const REMOVE_SENTINEL = 'remove'
const UNASSIGN_SENTINEL = 'unassign'
const MAX_GOALS_PER_OPERATION = 25

const GoalUpdateSchema = z.object({
    id: z.string().min(1).describe('The ID of the goal to update.'),
    name: z.string().min(1).optional().describe('New goal name.'),
    description: z
        .preprocess(
            (value) => (value === null ? REMOVE_SENTINEL : value),
            z.string().describe(`New description. Use "${REMOVE_SENTINEL}" to clear.`),
        )
        .optional(),
    deadline: z
        .preprocess(
            (value) => (value === null ? REMOVE_SENTINEL : value),
            z.string().describe(`New deadline (YYYY-MM-DD). Use "${REMOVE_SENTINEL}" to clear.`),
        )
        .optional(),
    responsibleUid: z
        .preprocess(
            (value) => (value === null ? UNASSIGN_SENTINEL : value),
            z.string().describe(`New responsible user ID. Use "${UNASSIGN_SENTINEL}" to clear.`),
        )
        .optional(),
})

type GoalUpdate = z.infer<typeof GoalUpdateSchema>

const SKIP_REASONS = ['no-fields', 'no-valid-values'] as const
type SkipReason = (typeof SKIP_REASONS)[number]

const ArgsSchema = {
    goals: z
        .array(GoalUpdateSchema)
        .min(1)
        .max(MAX_GOALS_PER_OPERATION)
        .describe(`The array of goals to update (max ${MAX_GOALS_PER_OPERATION}).`),
}

const SkippedGoalSchema = z.object({
    id: z.string().describe('The ID of the goal that was skipped.'),
    reason: z
        .enum(SKIP_REASONS)
        .describe(
            '"no-fields" = only the id was supplied; "no-valid-values" = all updatable fields were undefined.',
        ),
})

const OutputSchema = {
    goals: z.array(GoalOutputSchema).describe('The updated goals.'),
    totalCount: z.number().describe('The total number of goals updated.'),
    updatedGoalIds: z.array(z.string()).describe('The IDs of the updated goals.'),
    appliedOperations: z
        .object({
            updateCount: z.number().describe('The number of goals actually updated.'),
            skippedCount: z.number().describe('The number of goals skipped (no changes).'),
            skipped: z.array(SkippedGoalSchema).describe('Per-goal skip details (id + reason).'),
        })
        .describe('Summary of operations performed.'),
}

function mapSentinelToNull(value: string | undefined, sentinel: string): string | null | undefined {
    if (value === sentinel) return null
    return value
}

function getSkipReason({ id: _id, ...rest }: GoalUpdate): SkipReason | null {
    const values = Object.values(rest)
    if (values.length === 0) return 'no-fields'
    if (values.every((v) => v === undefined)) return 'no-valid-values'
    return null
}

const updateGoals = {
    name: ToolNames.UPDATE_GOALS,
    description: 'Update one or more goals by their IDs.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async execute({ goals }, client) {
        type Result =
            | { kind: 'updated'; goal: ReturnType<typeof mapGoal> }
            | { kind: 'skipped'; id: string; reason: SkipReason }

        const results: Result[] = await Promise.all(
            goals.map(async (goal): Promise<Result> => {
                const skipReason = getSkipReason(goal)
                if (skipReason !== null) {
                    return { kind: 'skipped', id: goal.id, reason: skipReason }
                }

                const { id, description, deadline, responsibleUid, ...rest } = goal
                const updated = await client.updateGoal(id, {
                    ...rest,
                    description: mapSentinelToNull(description, REMOVE_SENTINEL),
                    deadline: mapSentinelToNull(deadline, REMOVE_SENTINEL),
                    responsibleUid: mapSentinelToNull(responsibleUid, UNASSIGN_SENTINEL),
                })
                return { kind: 'updated', goal: mapGoal(updated) }
            }),
        )

        const updatedGoals = results
            .filter(
                (r): r is { kind: 'updated'; goal: ReturnType<typeof mapGoal> } =>
                    r.kind === 'updated',
            )
            .map((r) => r.goal)
        const skipped = results
            .filter(
                (r): r is { kind: 'skipped'; id: string; reason: SkipReason } =>
                    r.kind === 'skipped',
            )
            .map(({ id, reason }) => ({ id, reason }))

        const count = updatedGoals.length
        const goalList = updatedGoals.map((g) => `• ${g.name} (id=${g.id})`).join('\n')
        const skipNote = formatSkipNote(skipped)
        const textContent =
            count > 0
                ? `Updated ${count} goal${count === 1 ? '' : 's'}${skipNote}:\n${goalList}`
                : `Updated 0 goals${skipNote}`

        return {
            textContent,
            structuredContent: {
                goals: updatedGoals,
                totalCount: count,
                updatedGoalIds: updatedGoals.map((g) => g.id),
                appliedOperations: {
                    updateCount: count,
                    skippedCount: skipped.length,
                    skipped,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function formatSkipNote(skipped: Array<{ id: string; reason: SkipReason }>): string {
    if (skipped.length === 0) return ''
    const byReason = new Map<SkipReason, string[]>()
    for (const { id, reason } of skipped) {
        const existing = byReason.get(reason) ?? []
        existing.push(id)
        byReason.set(reason, existing)
    }
    const parts = Array.from(byReason.entries()).map(
        ([reason, ids]) => `${ids.length} skipped — ${reason} (${ids.join(', ')})`,
    )
    return ` (${parts.join('; ')})`
}

export { MAX_GOALS_PER_OPERATION, updateGoals }
