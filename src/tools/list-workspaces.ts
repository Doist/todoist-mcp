import {
    type TodoistApi,
    WORKSPACE_PLANS,
    WORKSPACE_ROLES,
    type WorkspacePlan,
    type WorkspaceRole,
} from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {}

const WorkspaceOutputSchema = {
    id: z.string().describe('The unique identifier for the workspace.'),
    name: z.string().describe('The name of the workspace.'),
    plan: z.enum(WORKSPACE_PLANS).describe('The workspace plan type.'),
    role: z
        .enum(WORKSPACE_ROLES)
        .optional()
        .describe("The user's role in the workspace, if available."),
    isLinkSharingEnabled: z
        .boolean()
        .describe('Whether link sharing is enabled for the workspace.'),
    isGuestAllowed: z.boolean().describe('Whether guests are allowed in the workspace.'),
    createdAt: z
        .string()
        .optional()
        .describe('The ISO 8601 timestamp when the workspace was created.'),
    creatorId: z.string().describe('The ID of the user who created the workspace.'),
}

const OutputSchema = {
    type: z.literal('workspaces').describe('The type of the response.'),
    workspaces: z.array(z.object(WorkspaceOutputSchema)).describe('List of workspaces.'),
    count: z.number().describe('The total number of workspaces.'),
}

type WorkspaceOutput = {
    id: string
    name: string
    plan: WorkspacePlan
    role?: WorkspaceRole
    isLinkSharingEnabled: boolean
    isGuestAllowed: boolean
    createdAt?: string
    creatorId: string
}

type WorkspacesStructured = Record<string, unknown> & {
    type: 'workspaces'
    workspaces: WorkspaceOutput[]
    count: number
}

async function generateWorkspacesList(
    client: TodoistApi,
): Promise<{ textContent: string; structuredContent: WorkspacesStructured }> {
    const workspaces = await client.getWorkspaces()

    const workspaceOutputs: WorkspaceOutput[] = workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
        role: workspace.role,
        isLinkSharingEnabled: workspace.isLinkSharingEnabled,
        isGuestAllowed: workspace.isGuestAllowed,
        createdAt: workspace.createdAt?.toISOString(),
        creatorId: workspace.creatorId,
    }))

    // Generate markdown text content
    const lines: string[] = ['# Workspaces', '']

    if (workspaceOutputs.length === 0) {
        lines.push('No workspaces found.')
    } else {
        lines.push(
            `Found ${workspaceOutputs.length} workspace${workspaceOutputs.length === 1 ? '' : 's'}:`,
            '',
        )

        for (const workspace of workspaceOutputs) {
            lines.push(`## ${workspace.name}`)
            lines.push(`- **ID:** ${workspace.id}`)
            lines.push(`- **Plan:** ${workspace.plan}`)
            if (workspace.role) {
                lines.push(`- **Your Role:** ${workspace.role}`)
            }
            lines.push(
                `- **Link Sharing:** ${workspace.isLinkSharingEnabled ? 'Enabled' : 'Disabled'}`,
            )
            lines.push(`- **Guests Allowed:** ${workspace.isGuestAllowed ? 'Yes' : 'No'}`)
            if (workspace.createdAt) {
                lines.push(`- **Created:** ${workspace.createdAt}`)
            }
            lines.push(`- **Creator ID:** ${workspace.creatorId}`)
            lines.push('')
        }
    }

    const textContent = lines.join('\n')

    const structuredContent: WorkspacesStructured = {
        type: 'workspaces',
        workspaces: workspaceOutputs,
        count: workspaceOutputs.length,
    }

    return { textContent, structuredContent }
}

const listWorkspaces = {
    name: ToolNames.LIST_WORKSPACES,
    description:
        'Get all workspaces for the authenticated user. Returns workspace details including ID, name, plan type (STARTER/BUSINESS), user role (ADMIN/MEMBER/GUEST), link sharing settings, guest permissions, creation date, and creator ID.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(_args, client) {
        const result = await generateWorkspacesList(client)

        return {
            textContent: result.textContent,
            structuredContent: result.structuredContent,
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { listWorkspaces, type WorkspaceOutput, type WorkspacesStructured }
