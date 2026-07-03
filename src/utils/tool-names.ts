/**
 * Centralized tool names module
 *
 * This module provides a single source of truth for all tool names used throughout the codebase.
 * Each tool should import its own name from this module to avoid hardcoded strings.
 * This prevents outdated references when tool names change.
 */
export const ToolNames = {
    // Task management tools
    ADD_TASKS: 'add-tasks',
    COMPLETE_TASKS: 'complete-tasks',
    UNCOMPLETE_TASKS: 'uncomplete-tasks',
    UPDATE_TASKS: 'update-tasks',
    FIND_TASKS: 'find-tasks',
    FIND_TASKS_BY_DATE: 'find-tasks-by-date',
    FIND_COMPLETED_TASKS: 'find-completed-tasks',
    RESCHEDULE_TASKS: 'reschedule-tasks',

    // Project management tools
    ADD_PROJECTS: 'add-projects',
    UPDATE_PROJECTS: 'update-projects',
    FIND_PROJECTS: 'find-projects',
    PROJECT_MANAGEMENT: 'project-management',
    PROJECT_MOVE: 'project-move',

    // Section management tools
    ADD_SECTIONS: 'add-sections',
    UPDATE_SECTIONS: 'update-sections',
    FIND_SECTIONS: 'find-sections',

    // Comment management tools
    ADD_COMMENTS: 'add-comments',
    UPDATE_COMMENTS: 'update-comments',
    FIND_COMMENTS: 'find-comments',

    // Reminder management tools
    ADD_REMINDERS: 'add-reminders',
    UPDATE_REMINDERS: 'update-reminders',
    FIND_REMINDERS: 'find-reminders',

    // Attachment tools
    VIEW_ATTACHMENT: 'view-attachment',

    // Assignment and collaboration tools
    FIND_PROJECT_COLLABORATORS: 'find-project-collaborators',
    MANAGE_ASSIGNMENTS: 'manage-assignments',

    // Activity and audit tools
    FIND_ACTIVITY: 'find-activity',
    GET_PRODUCTIVITY_STATS: 'get-productivity-stats',

    // Health and insights tools
    GET_PROJECT_HEALTH: 'get-project-health',
    GET_PROJECT_ACTIVITY_STATS: 'get-project-activity-stats',
    ANALYZE_PROJECT_HEALTH: 'analyze-project-health',
    GET_WORKSPACE_INSIGHTS: 'get-workspace-insights',

    // General tools
    GET_OVERVIEW: 'get-overview',
    DELETE_OBJECT: 'delete-object',
    FETCH_OBJECT: 'fetch-object',
    REORDER_OBJECTS: 'reorder-objects',
    USER_INFO: 'user-info',

    // Label management tools
    ADD_LABELS: 'add-labels',
    UPDATE_LABELS: 'update-labels',
    FIND_LABELS: 'find-labels',

    // Filter management tools
    FIND_FILTERS: 'find-filters',
    ADD_FILTERS: 'add-filters',
    UPDATE_FILTERS: 'update-filters',

    // Workspace tools
    LIST_WORKSPACES: 'list-workspaces',

    // OpenAI MCP tools
    SEARCH: 'search',
    FETCH: 'fetch',
} as const

// Type for all tool names
export type ToolName = (typeof ToolNames)[keyof typeof ToolNames]
