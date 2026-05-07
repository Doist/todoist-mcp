import { FEATURE_NAMES, type Feature, type FeatureName, type Features } from './mcp-helpers.js'
import { getMcpServer } from './mcp-server.js'
import {
    requireValidTodoistToken,
    type RequireValidTodoistTokenOptions,
} from './middleware/require-valid-todoist-token.js'
// Comment management tools
import { addComments } from './tools/add-comments.js'
// Filter management tools
import { addFilters } from './tools/add-filters.js'
// Label management tools
import { addLabels } from './tools/add-labels.js'
// Project management tools
import { addProjects } from './tools/add-projects.js'
// Section management tools
import { addSections } from './tools/add-sections.js'
// Task management tools
import { addTasks } from './tools/add-tasks.js'
import { analyzeProjectHealth } from './tools/analyze-project-health.js'
import { completeTasks } from './tools/complete-tasks.js'
// General tools
import { deleteObject } from './tools/delete-object.js'
import { fetch } from './tools/fetch.js'
// Activity and audit tools
import { findActivity } from './tools/find-activity.js'
import { findComments } from './tools/find-comments.js'
import { findCompletedTasks } from './tools/find-completed-tasks.js'
import { findFilters } from './tools/find-filters.js'
import { findLabels } from './tools/find-labels.js'
// Assignment and collaboration tools
import { findProjectCollaborators } from './tools/find-project-collaborators.js'
import { findProjects } from './tools/find-projects.js'
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
import { quickAddTask } from './tools/quick-add-task.js'
import { reorderObjects } from './tools/reorder-objects.js'
import { rescheduleTasks } from './tools/reschedule-tasks.js'
import { search } from './tools/search.js'
import { uncompleteTasks } from './tools/uncomplete-tasks.js'
import { updateComments } from './tools/update-comments.js'
import { updateFilters } from './tools/update-filters.js'
import { updateLabels } from './tools/update-labels.js'
import { updateProjects } from './tools/update-projects.js'
import { updateSections } from './tools/update-sections.js'
import { updateTasks } from './tools/update-tasks.js'
import { userInfo } from './tools/user-info.js'
import { viewAttachment } from './tools/view-attachment.js'
import { validateTodoistToken } from './utils/validate-todoist-token.js'

const tools = {
    // Task management tools
    addTasks,
    quickAddTask,
    completeTasks,
    uncompleteTasks,
    updateTasks,
    findTasks,
    findTasksByDate,
    findCompletedTasks,
    rescheduleTasks,
    // Project management tools
    addProjects,
    updateProjects,
    findProjects,
    // Section management tools
    addSections,
    updateSections,
    findSections,
    // Comment management tools
    addComments,
    updateComments,
    findComments,
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
    reorderObjects,
    userInfo,
    // Assignment and collaboration tools
    findProjectCollaborators,
    manageAssignments,
    // Workspace tools
    listWorkspaces,
    // OpenAI MCP tools
    search,
    fetch,
}

export {
    // Comment management tools
    addComments,
    addFilters,
    // Label management tools
    addLabels,
    // Project management tools
    addProjects,
    // Section management tools
    addSections,
    // Task management tools
    addTasks,
    analyzeProjectHealth,
    completeTasks,
    deleteObject,
    FEATURE_NAMES,
    type Feature,
    type FeatureName,
    type Features,
    fetch,
    // Activity and audit tools
    findActivity,
    findComments,
    findCompletedTasks,
    // Filter management tools
    findFilters,
    findLabels,
    // Assignment and collaboration tools
    findProjectCollaborators,
    findProjects,
    findSections,
    findTasks,
    findTasksByDate,
    getMcpServer,
    // General tools
    getOverview,
    getProductivityStats,
    getProjectActivityStats,
    // Health and insights tools
    getProjectHealth,
    getWorkspaceInsights,
    // Workspace tools
    listWorkspaces,
    manageAssignments,
    quickAddTask,
    reorderObjects,
    // Token validation middleware
    requireValidTodoistToken,
    type RequireValidTodoistTokenOptions,
    rescheduleTasks,
    // OpenAI MCP tools
    search,
    tools,
    uncompleteTasks,
    updateComments,
    updateFilters,
    updateLabels,
    updateProjects,
    updateSections,
    updateTasks,
    userInfo,
    // Token validation utility
    validateTodoistToken,
    // Attachment tools
    viewAttachment,
}
