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
    /** Maximum number of direct children returned when children are requested alongside an object */
    CHILDREN_MAX: 25,
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

// Batch Operation Limits
export const BatchLimits = {
    /** Maximum tasks accepted by one task create or update operation */
    TASKS_PER_OPERATION: 25,
} as const

// Concurrency Limits
export const ConcurrencyLimits = {
    /**
     * In-flight task-move requests per account.
     *
     * Kept at 1 because the API locks the whole task tree for a move, and a tree
     * spans a task's source as well as its destination — two moves of sibling
     * subtasks contend even when they target different projects, and the loser
     * fails. Batching same-destination moves into a single request means
     * serialising costs little in practice.
     */
    TASK_MOVES: 1,
    /** In-flight non-move write requests per account. */
    WRITES: 4,
    /**
     * How long a request may wait for a slot before it is abandoned unsent.
     *
     * Matches the SDK's own 30s request timeout, which only starts once a request
     * actually goes out: a task that has already waited that long would be
     * answering a caller who has given up. Comfortably above the worst realistic
     * queue (serialised moves to 100 distinct destinations is roughly 15s).
     */
    QUEUE_WAIT_MS: 30_000,
} as const

// Response Builder Configuration
export const ResponseConfig = {
    /** Maximum characters per line in text responses */
    MAX_LINE_LENGTH: 100,
    /** Indentation for nested items */
    INDENT_SIZE: 2,
} as const
