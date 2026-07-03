/**
 * Application-wide constants
 *
 * This module centralizes magic numbers and configuration values
 * to improve maintainability and provide a single source of truth.
 */

// API Pagination Limits
export const ApiLimits = {
    /** Default limit for task listings */
    TASKS_DEFAULT: 10,
    /** Maximum limit for task search and list operations */
    TASKS_MAX: 100,
    /** Default limit for completed tasks */
    COMPLETED_TASKS_DEFAULT: 50,
    /** Maximum limit for completed tasks */
    COMPLETED_TASKS_MAX: 200,
    /** Default limit for project listings */
    PROJECTS_DEFAULT: 50,
    /** Maximum limit for project listings */
    PROJECTS_MAX: 200,
    /** Maximum limit for section listings */
    SECTIONS_MAX: 200,
    /** Batch size for fetching all tasks in a project */
    TASKS_BATCH_SIZE: 50,
    /** Default limit for comment listings */
    COMMENTS_DEFAULT: 10,
    /** Maximum limit for comment search and list operations */
    COMMENTS_MAX: 10,
    /** Default limit for activity log listings */
    ACTIVITY_DEFAULT: 20,
    /** Maximum limit for activity log search and list operations */
    ACTIVITY_MAX: 100,
    /** Default limit for label listings */
    LABELS_DEFAULT: 50,
    /** Maximum limit for label listings */
    LABELS_MAX: 200,
    /** Default limit for reminder listings */
    REMINDERS_DEFAULT: 50,
    /** Maximum limit for reminder search operations */
    REMINDERS_MAX: 200,
} as const

// UI Display Limits
export const DisplayLimits = {
    /** Maximum number of failures to show in detailed error messages */
    MAX_FAILURES_SHOWN: 3,
    /** Threshold for suggesting batch operations */
    BATCH_OPERATION_THRESHOLD: 10,
} as const

// Response Builder Configuration
export const ResponseConfig = {
    /** Maximum characters per line in text responses */
    MAX_LINE_LENGTH: 100,
    /** Indentation for nested items */
    INDENT_SIZE: 2,
} as const
