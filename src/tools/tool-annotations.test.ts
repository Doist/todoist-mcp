import { describeToolAnnotations, listAdvertisedTools } from '@todoist/mcp-core/testing'
import { describe, expect, it } from 'vitest'
import { getMcpServer } from '../mcp-server.js'
import { ToolNames } from '../utils/tool-names.js'

const createServer = () => getMcpServer({ token: 'test-token' })

// Clients decide from these hints whether a call needs the user's confirmation, so each tool's are
// pinned here as a client receives them on tools/list. openWorldHint defaults to false: true only
// for tools that reach people or places outside the user's own Todoist account (notifications,
// public links).
describeToolAnnotations({
    createServer,
    expected: {
        [ToolNames.ADD_TASKS]: {
            title: 'Todoist: Add Tasks',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        [ToolNames.COMPLETE_TASKS]: {
            title: 'Todoist: Complete Tasks',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        [ToolNames.UNCOMPLETE_TASKS]: {
            title: 'Todoist: Uncomplete Tasks',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        },
        [ToolNames.UPDATE_TASKS]: {
            title: 'Todoist: Update Tasks',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
        [ToolNames.RESCHEDULE_TASKS]: {
            title: 'Todoist: Reschedule Tasks',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        [ToolNames.FIND_TASKS]: {
            title: 'Todoist: Find Tasks',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.FIND_TASKS_BY_DATE]: {
            title: 'Todoist: Find Tasks By Date',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.FIND_COMPLETED_TASKS]: {
            title: 'Todoist: Find Completed Tasks',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.ADD_PROJECTS]: {
            title: 'Todoist: Add Projects',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        },
        [ToolNames.UPDATE_PROJECTS]: {
            title: 'Todoist: Update Projects',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        [ToolNames.FIND_PROJECTS]: {
            title: 'Todoist: Find Projects',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.PROJECT_MANAGEMENT]: {
            title: 'Todoist: Project Management',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.PROJECT_MOVE]: {
            title: 'Todoist: Project Move',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
        },
        [ToolNames.ADD_SECTIONS]: {
            title: 'Todoist: Add Sections',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        },
        [ToolNames.UPDATE_SECTIONS]: {
            title: 'Todoist: Update Sections',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        [ToolNames.FIND_SECTIONS]: {
            title: 'Todoist: Find Sections',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.ADD_COMMENTS]: {
            title: 'Todoist: Add Comments',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        [ToolNames.UPDATE_COMMENTS]: {
            title: 'Todoist: Update Comments',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        [ToolNames.FIND_COMMENTS]: {
            title: 'Todoist: Find Comments',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.ADD_REMINDERS]: {
            title: 'Todoist: Add Reminders',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
        [ToolNames.UPDATE_REMINDERS]: {
            title: 'Todoist: Update Reminders',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        [ToolNames.FIND_REMINDERS]: {
            title: 'Todoist: Find Reminders',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.VIEW_ATTACHMENT]: {
            title: 'Todoist: View Attachment',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.ADD_LABELS]: {
            title: 'Todoist: Add Labels',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        },
        [ToolNames.UPDATE_LABELS]: {
            title: 'Todoist: Update Labels',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        [ToolNames.FIND_LABELS]: {
            title: 'Todoist: Find Labels',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.FIND_PROJECT_COLLABORATORS]: {
            title: 'Todoist: Find Project Collaborators',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.MANAGE_ASSIGNMENTS]: {
            title: 'Todoist: Manage Assignments',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
        },
        [ToolNames.FIND_FILTERS]: {
            title: 'Todoist: Find Filters',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.ADD_FILTERS]: {
            title: 'Todoist: Add Filters',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        },
        [ToolNames.UPDATE_FILTERS]: {
            title: 'Todoist: Update Filters',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        [ToolNames.FIND_ACTIVITY]: {
            title: 'Todoist: Find Activity',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.GET_PRODUCTIVITY_STATS]: {
            title: 'Todoist: Get Productivity Stats',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.GET_PROJECT_HEALTH]: {
            title: 'Todoist: Get Project Health',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.GET_PROJECT_ACTIVITY_STATS]: {
            title: 'Todoist: Get Project Activity Stats',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.ANALYZE_PROJECT_HEALTH]: {
            title: 'Todoist: Analyze Project Health',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.GET_WORKSPACE_INSIGHTS]: {
            title: 'Todoist: Get Workspace Insights',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.GET_OVERVIEW]: {
            title: 'Todoist: Get Overview',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.DELETE_OBJECT]: {
            title: 'Todoist: Delete Object',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
        },
        [ToolNames.FETCH_OBJECT]: {
            title: 'Todoist: Fetch Object',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.REORDER_OBJECTS]: {
            title: 'Todoist: Reorder Objects',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.USER_INFO]: {
            title: 'Todoist: User Info',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.GET_USER_STATUS]: {
            title: 'Todoist: Get User Status',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.SET_USER_STATUS]: {
            title: 'Todoist: Set User Status',
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: true,
        },
        [ToolNames.LIST_WORKSPACES]: {
            title: 'Todoist: List Workspaces',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.EXPORT_PROJECT_AS_CSV]: {
            title: 'Todoist: Export Project As CSV',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.IMPORT_INTO_PROJECT]: {
            title: 'Todoist: Import Into Project',
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        },
        [ToolNames.SEARCH]: {
            title: 'Todoist: Search',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        [ToolNames.FETCH]: {
            title: 'Todoist: Fetch',
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
    },
})

describe('MCP App metadata', () => {
    it('advertises both spellings of the find-tasks-by-date resource URI', async () => {
        const tool = (await listAdvertisedTools(createServer())).find(
            (advertised) => advertised.name === ToolNames.FIND_TASKS_BY_DATE,
        )
        const ui = tool?._meta?.ui as { resourceUri?: string } | undefined

        expect(ui?.resourceUri).toMatch(/^ui:\/\/todoist\/task-list@/)
        expect(tool?._meta?.['ui/resourceUri']).toBe(ui?.resourceUri)
    })
})
