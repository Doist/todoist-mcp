import { taskListResourceUri } from './mcp-apps/resources.js'
import type { AnyTodoistTool } from './todoist-tool.js'
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
import { exportProjectTemplate } from './tools/export-project-template.js'
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
import { importProjectTemplate } from './tools/import-project-template.js'
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

/**
 * `find-tasks-by-date` backed by the interactive task-list widget.
 *
 * The `_meta.ui` marker is what routes a tool through the MCP Apps registration
 * path and tells a host which resource to render its results with.
 */
const findTasksByDateWithUi = {
    ...findTasksByDate,
    _meta: {
        ui: {
            resourceUri: taskListResourceUri,
        },
    },
}

/**
 * Every tool the MCP server exposes, keyed by its public export name and held
 * in registration order.
 *
 * This is the single source of truth for the tool surface. The MCP server, the
 * package's public `tools` export, the schema validator and the token-footprint
 * baseline all derive from it, so a tool added here is picked up everywhere.
 *
 * Note this holds the *registered* objects, which is not always the bare tool
 * definition — `find-tasks-by-date` is wrapped to carry its widget metadata.
 */
const toolRegistry = {
    // Task management tools
    addTasks,
    completeTasks,
    uncompleteTasks,
    updateTasks,
    rescheduleTasks,
    findTasks,
    findTasksByDate: findTasksByDateWithUi,
    findCompletedTasks,

    // Project management tools
    addProjects,
    updateProjects,
    findProjects,
    projectManagement,
    projectMove,

    // Section management tools
    addSections,
    updateSections,
    findSections,

    // Comment management tools
    addComments,
    findComments,
    updateComments,

    // Reminder management tools
    addReminders,
    findReminders,
    updateReminders,

    // Attachment tools
    viewAttachment,

    // Label management tools
    addLabels,
    updateLabels,
    findLabels,

    // Filter management tools
    findFilters,
    addFilters,
    updateFilters,

    // Activity and audit tools
    findActivity,
    getProductivityStats,

    // Health and insights tools
    getProjectHealth,
    getProjectActivityStats,
    analyzeProjectHealth,
    getWorkspaceInsights,

    // General tools
    getOverview,
    deleteObject,
    fetchObject,
    reorderObjects,
    userInfo,

    // Assignment and collaboration tools
    findProjectCollaborators,
    manageAssignments,

    // Template tools
    exportProjectTemplate,
    importProjectTemplate,

    // Workspace tools
    listWorkspaces,

    // OpenAI MCP tools
    search,
    fetch,
}

/**
 * The registered tools in registration order.
 *
 * `tools/list` preserves this ordering, which is insertion order on
 * {@link toolRegistry}.
 */
const registeredTools: readonly AnyTodoistTool[] = Object.values(toolRegistry)

export { registeredTools, toolRegistry }
