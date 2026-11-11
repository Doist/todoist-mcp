import { HEALTH_STATUSES } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    projectId: z
        .string()
        .min(1)
        .describe(
            'The ID of the project to analyze. This triggers a new health analysis which may take some time to complete.',
        ),
}

const OutputSchema = {
    projectId: z.string().describe('The project ID.'),
    health: z
        .object({
            status: z
                .enum(HEALTH_STATUSES)
                .describe('The health status after triggering analysis.'),
            isStale: z
                .boolean()
                .describe('Whether the health data is still stale after the request.'),
            updateInProgress: z
                .boolean()
                .describe('Whether an analysis update is currently in progress.'),
        })
        .describe('The health response returned after triggering analysis.'),
    message: z.string().describe('A human-readable message about the analysis status.'),
}

const analyzeProjectHealth = {
    name: ToolNames.ANALYZE_PROJECT_HEALTH,
    description:
        'Trigger a new health analysis for a project. Use this when the health data is stale or you want a fresh assessment. The analysis may take time to complete — use get-project-health afterward to see updated results.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
    },
    async execute(args, client) {
        const { projectId } = args

        const health = await client.analyzeProjectHealth(projectId)

        const message = health.updateInProgress
            ? 'Health analysis is in progress. Use get-project-health shortly to see updated results.'
            : `Health analysis complete. Current status: ${health.status}.`

        return {
            textContent: `# Analyze Project Health\n\n${message}`,
            structuredContent: {
                projectId,
                health: {
                    status: health.status,
                    isStale: health.isStale,
                    updateInProgress: health.updateInProgress,
                },
                message,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { analyzeProjectHealth }
