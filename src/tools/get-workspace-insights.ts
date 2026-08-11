import { HEALTH_STATUSES } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'

const ArgsSchema = {
    workspaceIdOrName: z
        .string()
        .min(1)
        .describe(
            'The workspace ID or name. Supports exact ID, exact name match (case-insensitive), or unique partial name match.',
        ),
    projectIds: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe('Optional list of project IDs to scope insights to specific projects.'),
}

const ProjectInsightSchema = z.object({
    projectId: z.string().describe('The project ID.'),
    health: z
        .object({
            status: z.enum(HEALTH_STATUSES).describe('The health status of the project.'),
            isStale: z.boolean().describe('Whether the health data is stale.'),
            updateInProgress: z
                .boolean()
                .describe('Whether a health analysis update is in progress.'),
        })
        .nullable()
        .describe('Health data for this project, if available.'),
    progress: z
        .object({
            completedCount: z.number().describe('Number of completed tasks.'),
            activeCount: z.number().describe('Number of active tasks.'),
            progressPercent: z.number().describe('Completion percentage (0-100).'),
        })
        .nullable()
        .describe('Progress data for this project, if available.'),
})

const OutputSchema = {
    workspaceId: z.string().describe('The resolved workspace ID.'),
    workspaceName: z.string().describe('The resolved workspace name.'),
    folderId: z.string().nullable().describe('The folder ID, if applicable.'),
    projectInsights: z
        .array(ProjectInsightSchema)
        .describe('Health and progress insights for each project in the workspace.'),
}

const getWorkspaceInsights = {
    name: ToolNames.GET_WORKSPACE_INSIGHTS,
    description:
        'Get aggregated health and progress insights across all projects in a workspace. Accepts workspace name or ID, with optional project ID filtering. Useful for a cross-project health overview.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
    },
    async execute(args, client) {
        const { workspaceIdOrName, projectIds } = args

        const resolved = await workspaceResolver.resolveWorkspace(client, workspaceIdOrName)
        const insights = await client.getWorkspaceInsights(resolved.workspaceId, { projectIds })

        const projectInsights = insights.projectInsights.map((p) => ({
            projectId: p.projectId,
            health: p.health
                ? {
                      status: p.health.status,
                      isStale: p.health.isStale,
                      updateInProgress: p.health.updateInProgress,
                  }
                : null,
            progress: p.progress
                ? {
                      completedCount: p.progress.completedCount,
                      activeCount: p.progress.activeCount,
                      progressPercent: p.progress.progressPercent,
                  }
                : null,
        }))

        const lines: string[] = [
            `# Workspace Insights: ${resolved.workspaceName}`,
            '',
            `**Projects:** ${projectInsights.length}`,
            '',
        ]

        for (const insight of projectInsights) {
            const status = insight.health?.status ?? 'N/A'
            const progress = insight.progress ? `${insight.progress.progressPercent}%` : 'N/A'
            lines.push(`- Project ${insight.projectId}: status=${status}, progress=${progress}`)
        }

        return {
            textContent: lines.join('\n'),
            structuredContent: {
                workspaceId: resolved.workspaceId,
                workspaceName: resolved.workspaceName,
                folderId: insights.folderId ?? null,
                projectInsights,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { getWorkspaceInsights }
