import { encode } from 'gpt-tokenizer'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { instructions } from './mcp-server.js'
import type { TodoistTool } from './todoist-tool.js'
import { addComments } from './tools/add-comments.js'
import { addFilters } from './tools/add-filters.js'
import { addLabels } from './tools/add-labels.js'
import { addProjects } from './tools/add-projects.js'
import { addReminders } from './tools/add-reminders.js'
import { addSections } from './tools/add-sections.js'
import { addTasks } from './tools/add-tasks.js'
import { analyzeProjectHealth } from './tools/analyze-project-health.js'
import { completeTasks } from './tools/complete-tasks.js'
import { deleteObject } from './tools/delete-object.js'
import { fetchObject } from './tools/fetch-object.js'
import { fetch } from './tools/fetch.js'
import { findActivity } from './tools/find-activity.js'
import { findComments } from './tools/find-comments.js'
import { findCompletedTasks } from './tools/find-completed-tasks.js'
import { findFilters } from './tools/find-filters.js'
import { findLabels } from './tools/find-labels.js'
import { findProjectCollaborators } from './tools/find-project-collaborators.js'
import { findProjects } from './tools/find-projects.js'
import { findReminders } from './tools/find-reminders.js'
import { findSections } from './tools/find-sections.js'
import { findTasksByDate } from './tools/find-tasks-by-date.js'
import { findTasks } from './tools/find-tasks.js'
import { getOverview } from './tools/get-overview.js'
import { getProductivityStats } from './tools/get-productivity-stats.js'
import { getProjectActivityStats } from './tools/get-project-activity-stats.js'
import { getProjectHealth } from './tools/get-project-health.js'
import { getWorkspaceInsights } from './tools/get-workspace-insights.js'
import { listWorkspaces } from './tools/list-workspaces.js'
import { manageAssignments } from './tools/manage-assignments.js'
import { projectManagement } from './tools/project-management.js'
import { projectMove } from './tools/project-move.js'
import { reorderObjects } from './tools/reorder-objects.js'
import { rescheduleTasks } from './tools/reschedule-tasks.js'
import { search } from './tools/search.js'
import { uncompleteTasks } from './tools/uncomplete-tasks.js'
import { updateComments } from './tools/update-comments.js'
import { updateFilters } from './tools/update-filters.js'
import { updateLabels } from './tools/update-labels.js'
import { updateProjects } from './tools/update-projects.js'
import { updateReminders } from './tools/update-reminders.js'
import { updateSections } from './tools/update-sections.js'
import { updateTasks } from './tools/update-tasks.js'
import { userInfo } from './tools/user-info.js'
import { viewAttachment } from './tools/view-attachment.js'

// Mirror of getMcpServer()'s registration order, minus the runtime client.
// Keep in sync when tools are added/removed.
const allTools: TodoistTool<z.ZodRawShape, z.ZodRawShape>[] = [
    addTasks,
    completeTasks,
    uncompleteTasks,
    updateTasks,
    rescheduleTasks,
    findTasks,
    findTasksByDate,
    findCompletedTasks,
    addProjects,
    updateProjects,
    findProjects,
    projectManagement,
    projectMove,
    addSections,
    updateSections,
    findSections,
    addComments,
    findComments,
    updateComments,
    addReminders,
    findReminders,
    updateReminders,
    viewAttachment,
    addLabels,
    updateLabels,
    findLabels,
    findFilters,
    addFilters,
    updateFilters,
    findActivity,
    getProductivityStats,
    getProjectHealth,
    getProjectActivityStats,
    analyzeProjectHealth,
    getWorkspaceInsights,
    getOverview,
    deleteObject,
    fetchObject,
    reorderObjects,
    userInfo,
    findProjectCollaborators,
    manageAssignments,
    listWorkspaces,
    search,
    fetch,
] as unknown as TodoistTool<z.ZodRawShape, z.ZodRawShape>[]

function tokens(text: string): number {
    return encode(text).length
}

function formatToolTitle(name: string): string {
    return name
        .split('-')
        .filter(Boolean)
        .map((s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`)
        .join(' ')
}

function buildToolListEntry(tool: TodoistTool<z.ZodRawShape, z.ZodRawShape>) {
    const entry: Record<string, unknown> = {
        name: tool.name,
        title: `Todoist: ${formatToolTitle(tool.name)}`,
        description: tool.description,
        inputSchema: z.toJSONSchema(z.object(tool.parameters), { unrepresentable: 'any' }),
        annotations: {
            title: `Todoist: ${formatToolTitle(tool.name)}`,
            openWorldHint: false,
            ...tool.annotations,
        },
    }
    if (tool.outputSchema) {
        entry.outputSchema = z.toJSONSchema(z.object(tool.outputSchema), { unrepresentable: 'any' })
    }
    return entry
}

type Row = {
    name: string
    descriptionTokens: number
    inputSchemaTokens: number
    outputSchemaTokens: number
    totalTokens: number
}

function measure(): Row[] {
    return allTools.map((tool) => {
        const entry = buildToolListEntry(tool)
        const inputSchemaJson = JSON.stringify(entry.inputSchema)
        const outputSchemaJson = entry.outputSchema ? JSON.stringify(entry.outputSchema) : ''
        const fullEntryJson = JSON.stringify(entry)
        return {
            name: tool.name,
            descriptionTokens: tokens(tool.description),
            inputSchemaTokens: tokens(inputSchemaJson),
            outputSchemaTokens: outputSchemaJson ? tokens(outputSchemaJson) : 0,
            totalTokens: tokens(fullEntryJson),
        }
    })
}

// Budget for the combined fixed token cost (tools/list payload + instructions).
// Bump deliberately when adding tools or expanding descriptions. Override at
// runtime with MCP_TOKEN_BUDGET=NNNN to experiment without editing the source.
const DEFAULT_TOKEN_BUDGET = 40_000
const TOKEN_BUDGET = Number(process.env.MCP_TOKEN_BUDGET ?? DEFAULT_TOKEN_BUDGET)

describe('token footprint baseline', () => {
    it('reports per-tool and total token cost', () => {
        const rows = measure().sort((a, b) => b.totalTokens - a.totalTokens)
        const toolsListTotal = rows.reduce((acc, r) => acc + r.totalTokens, 0)
        const instructionsTokens = tokens(instructions)
        const combinedFixed = toolsListTotal + instructionsTokens

        const pad = (s: string | number, n: number) => String(s).padStart(n)
        const lines: string[] = []
        lines.push('')
        lines.push('=== MCP token footprint baseline ===')
        lines.push(`tools registered:    ${allTools.length}`)
        lines.push(`instructions string: ${instructionsTokens} tokens`)
        lines.push(`tools/list payload:  ${toolsListTotal} tokens`)
        lines.push(`combined fixed cost: ${combinedFixed} tokens`)
        lines.push(`budget:              ${TOKEN_BUDGET} tokens`)
        lines.push('')
        lines.push('Per-tool ranking (total / desc / inputSchema / outputSchema):')
        for (const r of rows) {
            lines.push(
                `  ${pad(r.totalTokens, 5)}  ${pad(r.descriptionTokens, 4)}  ${pad(
                    r.inputSchemaTokens,
                    5,
                )}  ${pad(r.outputSchemaTokens, 5)}   ${r.name}`,
            )
        }
        // biome-ignore lint/suspicious/noConsole: intentional baseline output
        console.log(lines.join('\n'))

        // Soft budget cap: fails only on catastrophic growth, not normal drift.
        // Per-tool numbers above are the informative signal for reviewers.
        expect(combinedFixed).toBeLessThan(TOKEN_BUDGET)
    })
})
