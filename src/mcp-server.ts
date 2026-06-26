import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerTaskListApp, taskListResourceUri } from './mcp-apps/resources.js'
import {
    FEATURE_NAMES,
    type Feature,
    type FeatureName,
    type Features,
    registerTool,
} from './mcp-helpers.js'
import { productivityAnalysis } from './prompts/productivity-analysis.js'
import { addComments } from './tools/add-comments.js'
import { addFilters } from './tools/add-filters.js'
import { addGoals } from './tools/add-goals.js'
import { addLabels } from './tools/add-labels.js'
import { addProjects } from './tools/add-projects.js'
import { addReminders } from './tools/add-reminders.js'
import { addSections } from './tools/add-sections.js'
import { addTasks } from './tools/add-tasks.js'
import { analyzeProjectHealth } from './tools/analyze-project-health.js'
import { completeGoals } from './tools/complete-goals.js'
import { completeTasks } from './tools/complete-tasks.js'
import { deleteObject } from './tools/delete-object.js'
import { fetchObject } from './tools/fetch-object.js'
import { fetch } from './tools/fetch.js'
import { findActivity } from './tools/find-activity.js'
import { findComments } from './tools/find-comments.js'
import { findCompletedTasks } from './tools/find-completed-tasks.js'
import { findFilters } from './tools/find-filters.js'
import { findGoals } from './tools/find-goals.js'
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
import { linkGoalTasks } from './tools/link-goal-tasks.js'
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
import { updateGoals } from './tools/update-goals.js'
import { updateLabels } from './tools/update-labels.js'
import { updateProjects } from './tools/update-projects.js'
import { updateReminders } from './tools/update-reminders.js'
import { updateSections } from './tools/update-sections.js'
import { updateTasks } from './tools/update-tasks.js'
import { userInfo } from './tools/user-info.js'
import { viewAttachment } from './tools/view-attachment.js'
import { TODOIST_MCP_VERSION, createTodoistClient } from './usage-tracking.js'

export const instructions = `
## Todoist Task and Project Management Tools

You have access to comprehensive Todoist management tools for personal productivity and team collaboration. Use these tools to help users manage tasks, projects, sections, comments, and assignments effectively.

### Core Capabilities:
- Create, update, complete, and search tasks with rich metadata (priorities, due dates, durations, assignments)
- Manage projects and sections with flexible organization
- Handle comments and collaboration features
- Bulk assignment operations for team workflows
- Get overviews and insights about workload and progress

### Tool Usage Guidelines:

**Task Management:**
- **add-tasks**: Create tasks (max 25 per call) with content, description, priority (\`p1\`, \`p2\`, \`p3\`, \`p4\` strings only; \`p1\` highest and \`p4\` lowest/default; integers are not accepted), dueString (natural language like "tomorrow", "next Friday", "2024-12-25"), deadlineDate (ISO 8601 format like "2025-12-31" for immovable constraints), duration (formats like "2h", "90m", "2h30m"), and assignments to project collaborators
- **update-tasks**: Modify existing tasks - get task IDs from search results first, only include fields that need changes. Supports priority updates using \`p1\`/\`p2\`/\`p3\`/\`p4\` string values (\`p1\` highest, \`p4\` lowest/default; integers are not accepted), due date updates via dueString and due date removal via "dueString: remove", plus deadlineDate (ISO 8601 format like "2025-12-31") updates and removals via "deadlineDate: remove". **IMPORTANT: Do NOT use update-tasks to reschedule/move task dates — use reschedule-tasks instead.** update-tasks replaces the entire due string which destroys recurrence patterns on recurring tasks.
- **reschedule-tasks**: **Always use this tool when moving/rescheduling task due dates to a different date.** This tool preserves recurring schedules and existing time-of-day. Accepts YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS. Works for both recurring and non-recurring tasks. Do NOT use update-tasks for rescheduling.
- **complete-tasks**: Mark tasks as done using task IDs
- **uncomplete-tasks**: Reopen completed tasks using task IDs
- **find-tasks**: Search by text, project/section/parent container, responsible user, labels, a raw Todoist \`filter\` string (e.g. "today", "p1", "##Work", "(today | overdue) & p1"), or a saved filter by ID or name (\`filterIdOrName\`). Requires at least one search parameter. \`filter\`/\`filterIdOrName\` cannot be combined with projectId/sectionId/parentId, and \`filter\` and \`filterIdOrName\` are mutually exclusive.
- **find-tasks-by-date**: Get tasks by date range (startDate: YYYY-MM-DD or 'today' which includes overdue tasks) or specific day counts
- **find-completed-tasks**: View completed tasks by completion date or original due date; if since/until are omitted, defaults to the last 7 days (returns all collaborators unless filtered)

**Project & Organization:**
- **add-projects/update-projects/find-projects**: Manage project lifecycle with names, descriptions (Markdown), favorites, view styles (list/board/calendar), and workspace assignment for new projects (by name or ID). find-projects returns active projects by default; pass archivedStatus ('archived' or 'all') to include archived projects. Every returned project includes an isArchived field
- **project-management**: Archive or unarchive projects by ID
- To delete a project (active or archived), use **delete-object** with type "project". Note: workspace projects must be archived first; personal projects can be deleted regardless
- **project-move**: Move projects between personal and workspace contexts
- **add-sections/update-sections/find-sections**: Organize tasks within projects using sections
- **find-goals/add-goals/update-goals**: Manage goals (personal or workspace). Goals track progress via linked tasks
- **complete-goals**: Complete or uncomplete goals by ID
- **link-goal-tasks**: Link or unlink tasks to/from a goal
- **get-overview**: Get comprehensive Markdown overview of entire account or specific project with task hierarchies. Project data includes parentId (sub-projects), folderId (workspace folder membership), and childOrder (sibling ordering)
- **list-workspaces**: Get all workspaces for the user with details like plan type, role, and settings

**Reminders:**
- **add-reminders**: Create reminders for tasks. Three types: "relative" (minutes before due), "absolute" (specific date/time), or "location" (geofence-triggered). Each reminder must specify a taskId.
- **find-reminders**: Find reminders by task ID (returns both time-based and location reminders), or get a specific reminder by ID (use reminderId for time-based, locationReminderId for location-based).
- **update-reminders**: Update existing reminders. Must specify the reminder type ("relative", "absolute", or "location") and ID.
- Relative and absolute reminders support an **isUrgent** flag to mark a reminder as urgent.
- Reminders can be deleted using **delete-object** with type "reminder" (time-based) or "location_reminder" (location-based).

**Collaboration & Comments:**
- **add-comments/update-comments/find-comments**: Manage task and project discussions
- **view-attachment**: View file attachments from comments. Pass the fileUrl from a comment's fileAttachment. Returns images inline, text files as text, and binary files as embedded resources.
- **find-project-collaborators**: Look up Todoist users (collaborators, teammates) by name or email to get their user ID — use for "find/who is X" questions or any time you need to resolve a person's name to an ID. By default searches collaborators of every shared project the authenticated user can access (plus the authenticated user themselves). An empty result means the person is not a collaborator on any shared project, not that they do not exist. Pass projectId to scope to a single project
- **manage-assignments**: Bulk assign/unassign/reassign up to 50 tasks with atomic operations and dry-run validation

**Filters:**
- **find-filters**: List all personal filters or search by name; filters are saved task views using query syntax
- **add-filters**: Create personal filters with name, query (e.g. "today & p1"), color, and favorite flag
- **update-filters**: Modify existing filters' name, query, color, or favorite status

**Activity & Audit:**
- **find-activity**: Retrieve recent activity logs to monitor and audit changes. Shows events from all users by default; use initiatorId to filter by specific user. Filter by object type (task/project/comment), event type (added/updated/deleted/completed/uncompleted/archived/unarchived/shared/left), and specific objects (objectId, projectId, taskId). Useful for tracking who did what and when. Note: Date-based filtering is not supported.
- **get-productivity-stats**: Get comprehensive productivity statistics including daily/weekly completion breakdowns, goal streaks (current, last, max), karma score and trends, and historical karma data. No parameters required.

**Project Health & Insights:**
- **get-project-health**: Get comprehensive health assessment for a project including completion progress (completed/active counts, percentage), health status (EXCELLENT/ON_TRACK/AT_RISK/CRITICAL), description, and task-level recommendations. Use includeContext=true for detailed metrics (overdue tasks, weekly activity, avg completion time) and full task data. Health data may be stale — check isStale flag.
- **get-project-activity-stats**: Get daily and optional weekly activity statistics for a project over a configurable time window (1-12 weeks). Useful for identifying activity trends.
- **analyze-project-health**: Trigger a new health analysis for a project. Use when health data is stale. The analysis may take time — use get-project-health afterward to see updated results.
- **get-workspace-insights**: Get aggregated health and progress insights across all projects in a workspace. Accepts workspace name or ID, with optional project ID filtering.

**General Operations:**
- **delete-object**: Remove projects, sections, tasks, comments, labels, filters, reminders, or location reminders by type and ID. Deletes both active and archived projects (workspace projects must be archived first; use find-projects with archivedStatus to locate archived projects)
- **fetch-object**: Fetch a single task, project, comment, or section by its ID
- **reorder-objects**: Reorder sibling projects or sections, and optionally move projects to a new parent. For projects: set order to reorder siblings, and/or set parentId to move under a new parent (use "root" for top level). For sections: set order to reorder within a project
- **user-info**: Get user details including timezone, goals, and plan information

### Best Practices:

1. **Task Creation**: Write clear, actionable task titles. Use natural language for due dates ("tomorrow", "next Monday"). Set appropriate priorities and include detailed descriptions when needed.

2. **Search Strategy**: Use specific search queries combining multiple filters for precise results. When searching for tasks, start with broader queries and narrow down as needed.

3. **Assignments & user lookup**: Always validate project collaborators exist before assigning tasks. Use find-project-collaborators to verify user access. Also use find-project-collaborators (with just a searchTerm and no projectId) to resolve a user's ID whenever the user references a person by name or email — it searches collaborators of all shared projects you can access, plus yourself.

4. **Bulk Operations**: When working with multiple items, prefer bulk tools (complete-tasks, manage-assignments) over individual operations for better performance.

5. **Date Handling**: All dates respect user timezone settings. Use 'today' keyword for dynamic date filtering (includes overdue tasks). **When rescheduling/moving tasks to a different date, always use reschedule-tasks** — never update-tasks with dueString, as that destroys recurrence on recurring tasks.

6. **Labels**: Use label filtering with AND/OR operators for advanced task organization. Most search tools support labels parameter. Use **find-labels** to discover personal and shared labels — use label **names** (not IDs) when filtering tasks, and use label **IDs** only with **delete-object** and **update-labels** (for personal label updates). Use **add-labels** to create new personal labels. Use **update-labels** to rename or recolor personal labels (by ID), or to rename shared labels (by name) — note that shared labels support renaming only, not color/order/favorite changes.

7. **Pagination**: Large result sets use cursor-based pagination. Use limit parameter to control result size (default varies by tool).

8. **Error Handling**: All tools provide detailed error messages and next-step suggestions. Pay attention to validation feedback for corrective actions. Batch tools (e.g. add-tasks, update-tasks) report per-item \`failures\` alongside successes — a single failed item does not undo the rest of the batch. When an item fails, **do not retry the whole batch**; inspect its failure reason and only re-send the items that are actually fixable.

### Common Workflows:

- **Daily Planning**: Use find-tasks-by-date with 'today' and get-overview for project status
- **Team Assignment**: find-project-collaborators → add-tasks with responsibleUser → manage-assignments for bulk changes
- **User Lookup**: find-project-collaborators with just a searchTerm (no projectId) to resolve a name or email to a Todoist user ID across all shared-project collaborators you can access
- **Task Search**: find-tasks with multiple filters → update-tasks or complete-tasks based on results
- **Project Organization**: add-projects → add-sections → add-tasks with projectId and sectionId
- **Progress Reviews**: find-completed-tasks (defaults to last 7 days; optionally use explicit date ranges) → get-overview for project summaries
- **Activity Auditing**: find-activity with event/object filters to track changes, monitor team activity, or investigate specific actions
- **Productivity Analysis**: Use the productivity-analysis prompt for comprehensive analysis combining user-info, get-productivity-stats, and find-completed-tasks data into actionable insights
- **Project Health Reviews**: get-project-health → analyze-project-health if stale → get-project-health with includeContext=true for detailed metrics → get-workspace-insights for cross-project overview

Always provide clear, actionable task titles and descriptions. Use the overview tools to give users context about their workload and project status.
`

/**
 * Create the MCP server.
 * @param todoistApiKey - The API key for the todoist account.
 * @param baseUrl - The base URL for the todoist API.
 * @param features - Features to enable for the server.
 * @returns the MCP server.
 */
function getMcpServer({
    todoistApiKey,
    baseUrl,
    features = [],
}: {
    todoistApiKey: string
    baseUrl?: string
    features?: Features
}) {
    const server = new McpServer(
        { name: 'todoist-mcp-server', version: TODOIST_MCP_VERSION },
        {
            capabilities: {
                tools: { listChanged: true },
                prompts: { listChanged: true },
            },
            instructions,
        },
    )

    const todoist = createTodoistClient(todoistApiKey, { baseUrl })

    /**
     * MCP Apps
     */
    const findTasksByDateToolWithUi = {
        ...findTasksByDate,
        _meta: {
            ui: {
                resourceUri: taskListResourceUri,
            },
        },
    }

    registerTaskListApp(server)

    /**
     * Tools
     */
    const toolArgs = { server, client: todoist, features }

    // Task management tools
    registerTool({ tool: addTasks, ...toolArgs })
    registerTool({ tool: completeTasks, ...toolArgs })
    registerTool({ tool: uncompleteTasks, ...toolArgs })
    registerTool({ tool: updateTasks, ...toolArgs })
    registerTool({ tool: rescheduleTasks, ...toolArgs })
    registerTool({ tool: findTasks, ...toolArgs })
    registerTool({ tool: findTasksByDateToolWithUi, ...toolArgs })
    registerTool({ tool: findCompletedTasks, ...toolArgs })

    // Project management tools
    registerTool({ tool: addProjects, ...toolArgs })
    registerTool({ tool: updateProjects, ...toolArgs })
    registerTool({ tool: findProjects, ...toolArgs })
    registerTool({ tool: projectManagement, ...toolArgs })
    registerTool({ tool: projectMove, ...toolArgs })

    // Section management tools
    registerTool({ tool: addSections, ...toolArgs })
    registerTool({ tool: updateSections, ...toolArgs })
    registerTool({ tool: findSections, ...toolArgs })

    // Goal management tools
    registerTool({ tool: findGoals, ...toolArgs })
    registerTool({ tool: addGoals, ...toolArgs })
    registerTool({ tool: updateGoals, ...toolArgs })
    registerTool({ tool: completeGoals, ...toolArgs })
    registerTool({ tool: linkGoalTasks, ...toolArgs })

    // Comment management tools
    registerTool({ tool: addComments, ...toolArgs })
    registerTool({ tool: findComments, ...toolArgs })
    registerTool({ tool: updateComments, ...toolArgs })

    // Reminder management tools
    registerTool({ tool: addReminders, ...toolArgs })
    registerTool({ tool: findReminders, ...toolArgs })
    registerTool({ tool: updateReminders, ...toolArgs })

    // Attachment tools
    registerTool({ tool: viewAttachment, ...toolArgs })

    // Label management tools
    registerTool({ tool: addLabels, ...toolArgs })
    registerTool({ tool: updateLabels, ...toolArgs })
    registerTool({ tool: findLabels, ...toolArgs })

    // Filter management tools
    registerTool({ tool: findFilters, ...toolArgs })
    registerTool({ tool: addFilters, ...toolArgs })
    registerTool({ tool: updateFilters, ...toolArgs })

    // Activity and audit tools
    registerTool({ tool: findActivity, ...toolArgs })
    registerTool({ tool: getProductivityStats, ...toolArgs })

    // Health and insights tools
    registerTool({ tool: getProjectHealth, ...toolArgs })
    registerTool({ tool: getProjectActivityStats, ...toolArgs })
    registerTool({ tool: analyzeProjectHealth, ...toolArgs })
    registerTool({ tool: getWorkspaceInsights, ...toolArgs })

    // General tools
    registerTool({ tool: getOverview, ...toolArgs })
    registerTool({ tool: deleteObject, ...toolArgs })
    registerTool({ tool: fetchObject, ...toolArgs })
    registerTool({ tool: reorderObjects, ...toolArgs })
    registerTool({ tool: userInfo, ...toolArgs })

    // Assignment and collaboration tools
    registerTool({ tool: findProjectCollaborators, ...toolArgs })
    registerTool({ tool: manageAssignments, ...toolArgs })

    // Workspace tools
    registerTool({ tool: listWorkspaces, ...toolArgs })

    // OpenAI MCP tools
    registerTool({ tool: search, ...toolArgs })
    registerTool({ tool: fetch, ...toolArgs })

    /**
     * Prompts
     */
    server.registerPrompt(
        productivityAnalysis.name,
        {
            title: productivityAnalysis.title,
            description: productivityAnalysis.description,
            argsSchema: productivityAnalysis.argsSchema,
        },
        productivityAnalysis.callback,
    )

    return server
}

export { FEATURE_NAMES, type Feature, type FeatureName, type Features, getMcpServer }
