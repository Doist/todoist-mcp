#!/usr/bin/env npx tsx
/**
 * Run any Todoist tool directly without going through MCP.
 *
 * Usage:
 *   npx tsx scripts/run-tool.ts <tool-name> '<json-args>'
 *   npx tsx scripts/run-tool.ts <tool-name> --file <args.json>
 *   npx tsx scripts/run-tool.ts --list
 *
 * Examples:
 *   npx tsx scripts/run-tool.ts add-tasks '{"tasks":[{"content":"Test task","order":1}]}'
 *   npx tsx scripts/run-tool.ts find-tasks '{"searchText":"meeting"}'
 *   npx tsx scripts/run-tool.ts get-overview '{}'
 *
 * Requires TODOIST_API_KEY in .env file (and optionally TODOIST_BASE_URL).
 */
import { readFileSync } from 'node:fs'
import { TodoistApi } from '@doist/todoist-sdk'
import { config } from 'dotenv'
import { addComments } from '../src/tools/add-comments.js'
import { addFilters } from '../src/tools/add-filters.js'
import { addLabels } from '../src/tools/add-labels.js'
import { addProjects } from '../src/tools/add-projects.js'
import { addSections } from '../src/tools/add-sections.js'
import { addTasks } from '../src/tools/add-tasks.js'
import { analyzeProjectHealth } from '../src/tools/analyze-project-health.js'
import { completeTasks } from '../src/tools/complete-tasks.js'
import { deleteObject } from '../src/tools/delete-object.js'
import { fetchObject } from '../src/tools/fetch-object.js'
import { fetch } from '../src/tools/fetch.js'
import { findActivity } from '../src/tools/find-activity.js'
import { findComments } from '../src/tools/find-comments.js'
import { findCompletedTasks } from '../src/tools/find-completed-tasks.js'
import { findFilters } from '../src/tools/find-filters.js'
import { findLabels } from '../src/tools/find-labels.js'
import { findProjectCollaborators } from '../src/tools/find-project-collaborators.js'
import { findProjects } from '../src/tools/find-projects.js'
import { findSections } from '../src/tools/find-sections.js'
import { findTasksByDate } from '../src/tools/find-tasks-by-date.js'
import { findTasks } from '../src/tools/find-tasks.js'
import { getOverview } from '../src/tools/get-overview.js'
import { getProjectActivityStats } from '../src/tools/get-project-activity-stats.js'
import { getProjectHealth } from '../src/tools/get-project-health.js'
import { getWorkspaceInsights } from '../src/tools/get-workspace-insights.js'
import { listWorkspaces } from '../src/tools/list-workspaces.js'
import { manageAssignments } from '../src/tools/manage-assignments.js'
import { projectManagement } from '../src/tools/project-management.js'
import { projectMove } from '../src/tools/project-move.js'
import { reorderObjects } from '../src/tools/reorder-objects.js'
import { rescheduleTasks } from '../src/tools/reschedule-tasks.js'
import { search } from '../src/tools/search.js'
import { uncompleteTasks } from '../src/tools/uncomplete-tasks.js'
import { updateComments } from '../src/tools/update-comments.js'
import { updateFilters } from '../src/tools/update-filters.js'
import { updateLabels } from '../src/tools/update-labels.js'
import { updateProjects } from '../src/tools/update-projects.js'
import { updateSections } from '../src/tools/update-sections.js'
import { updateTasks } from '../src/tools/update-tasks.js'
import { userInfo } from '../src/tools/user-info.js'
import { viewAttachment } from '../src/tools/view-attachment.js'
import { createTodoistClient, runWithUsageTrackingContext } from '../src/usage-tracking.js'

config()

// Define a minimal type for tool execution that works with any tool
type ExecutableTool = {
    name: string
    description: string
    execute: (
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any -- tools have varying parameter schemas
        args: any,
        client: TodoistApi,
    ) => Promise<{ textContent?: string; structuredContent?: unknown; contentItems?: unknown[] }>
}

const tools: Record<string, ExecutableTool> = {
    'add-tasks': addTasks,
    'add-projects': addProjects,
    'add-filters': addFilters,
    'add-sections': addSections,
    'add-comments': addComments,
    'add-labels': addLabels,
    'complete-tasks': completeTasks,
    'uncomplete-tasks': uncompleteTasks,
    'delete-object': deleteObject,
    fetch: fetch,
    'fetch-object': fetchObject,
    'find-activity': findActivity,
    'find-comments': findComments,
    'find-filters': findFilters,
    'find-completed-tasks': findCompletedTasks,
    'find-labels': findLabels,
    'find-project-collaborators': findProjectCollaborators,
    'find-projects': findProjects,
    'find-sections': findSections,
    'find-tasks': findTasks,
    'find-tasks-by-date': findTasksByDate,
    'get-overview': getOverview,
    'get-project-health': getProjectHealth,
    'get-project-activity-stats': getProjectActivityStats,
    'analyze-project-health': analyzeProjectHealth,
    'get-workspace-insights': getWorkspaceInsights,
    'list-workspaces': listWorkspaces,
    'manage-assignments': manageAssignments,
    'project-management': projectManagement,
    'project-move': projectMove,
    'reorder-objects': reorderObjects,
    'reschedule-tasks': rescheduleTasks,
    search: search,
    'update-comments': updateComments,
    'update-filters': updateFilters,
    'update-labels': updateLabels,
    'update-projects': updateProjects,
    'update-sections': updateSections,
    'update-tasks': updateTasks,
    'user-info': userInfo,
    'view-attachment': viewAttachment,
}

function printUsage() {
    console.log(`
Usage:
  npx tsx scripts/run-tool.ts <tool-name> '<json-args>'
  npx tsx scripts/run-tool.ts <tool-name> --file <args.json>
  npx tsx scripts/run-tool.ts --list

Available tools:
${Object.keys(tools)
    .sort()
    .map((name) => `  - ${name}`)
    .join('\n')}
`)
}

async function main() {
    const args = process.argv.slice(2)

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printUsage()
        process.exit(0)
    }

    if (args[0] === '--list') {
        console.log('Available tools:')
        for (const name of Object.keys(tools).sort()) {
            const tool = tools[name]
            console.log(`\n${name}:`)
            console.log(`  ${tool.description}`)
        }
        process.exit(0)
    }

    const toolName = args[0]
    const tool = tools[toolName]

    if (!tool) {
        console.error(`Unknown tool: ${toolName}`)
        console.error(`Available tools: ${Object.keys(tools).sort().join(', ')}`)
        process.exit(1)
    }

    let jsonArgs: string
    if (args[1] === '--file') {
        if (!args[2]) {
            console.error('--file requires a path argument')
            process.exit(1)
        }
        jsonArgs = readFileSync(args[2], 'utf-8')
    } else {
        jsonArgs = args[1] || '{}'
    }

    let parsedArgs: unknown
    try {
        parsedArgs = JSON.parse(jsonArgs)
    } catch (e) {
        console.error('Invalid JSON args:', e)
        process.exit(1)
    }

    const apiKey = process.env.TODOIST_API_KEY
    if (!apiKey) {
        console.error('TODOIST_API_KEY not found in environment or .env file')
        process.exit(1)
    }

    const baseUrl = process.env.TODOIST_BASE_URL
    const client = createTodoistClient(apiKey, {
        baseUrl,
        // Local direct runs are a dev helper, not real MCP traffic.
        tracking: { enabled: false },
    })

    console.log(`Running ${toolName} with args:`)
    console.log(JSON.stringify(parsedArgs, null, 2))
    console.log('---')

    try {
        const result = await runWithUsageTrackingContext(tool.name, () =>
            tool.execute(parsedArgs, client),
        )

        if (result.textContent) {
            console.log('\nText output:')
            console.log(result.textContent)
        }

        if (result.structuredContent) {
            console.log('\nStructured output:')
            console.log(JSON.stringify(result.structuredContent, null, 2))
        }

        if (result.contentItems?.length) {
            console.log(`\nContent items: ${result.contentItems.length}`)
            for (const item of result.contentItems) {
                const entry = item as Record<string, unknown>
                if (entry.type === 'image') {
                    const data = entry.data as string
                    console.log(
                        `  [image] ${entry.mimeType} (${Math.round((data.length * 0.75) / 1024)}KB base64)`,
                    )
                } else if (entry.type === 'text') {
                    const text = entry.text as string
                    console.log(`  [text] ${text.length > 200 ? `${text.slice(0, 200)}...` : text}`)
                } else if (entry.type === 'resource') {
                    const resource = entry.resource as Record<string, unknown>
                    const blob = resource.blob as string
                    console.log(
                        `  [resource] ${resource.mimeType} (${Math.round((blob.length * 0.75) / 1024)}KB base64)`,
                    )
                }
            }
        }
    } catch (error) {
        console.error('Tool execution failed:', error)
        process.exit(1)
    }
}

main()
