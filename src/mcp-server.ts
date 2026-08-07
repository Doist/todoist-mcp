import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerTaskListApp } from './mcp-apps/resources.js'
import {
    FEATURE_NAMES,
    type Feature,
    type FeatureName,
    type Features,
    registerTool,
} from './mcp-helpers.js'
import { productivityAnalysis } from './prompts/productivity-analysis.js'
import { registeredTools } from './tool-registry.js'
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
- **add-tasks**: Create tasks (max 25 per call) with content, description, priority (\`p1\`, \`p2\`, \`p3\`, \`p4\` strings only; \`p1\` highest and \`p4\` lowest/default; integers are not accepted), dueString (natural language like "tomorrow", "next Friday", "2024-12-25"; also use natural language for recurrences and do not prefix them with \`recurring\`), deadlineDate (ISO 8601 format like "2025-12-31" for immovable constraints), duration (formats like "2h", "90m", "2h30m"), and assignments to project collaborators
- **update-tasks**: Modify existing tasks - get task IDs from search results first, only include fields that need changes. Supports priority updates using \`p1\`/\`p2\`/\`p3\`/\`p4\` string values (\`p1\` highest, \`p4\` lowest/default; integers are not accepted), due date updates via dueString and due date removal via "dueString: remove", plus deadlineDate (ISO 8601 format like "2025-12-31") updates and removals via "deadlineDate: remove". **IMPORTANT: Do NOT use update-tasks to reschedule/move task dates — use reschedule-tasks instead.** update-tasks replaces the entire due string which destroys recurrence patterns on recurring tasks. Never echo back a task's existing projectId/sectionId/parentId — those fields are treated as a move.
- **reschedule-tasks**: **Always use this tool when moving/rescheduling task due dates to a different date.** This tool preserves recurring schedules and existing time-of-day. Accepts YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS. Works for both recurring and non-recurring tasks. Do NOT use update-tasks for rescheduling.
- **complete-tasks**: Mark tasks as done using task IDs
- **uncomplete-tasks**: Reopen completed tasks using task IDs
- **find-tasks**: Search by text, project/section/parent container, responsible user, labels, a raw Todoist \`filter\` string (e.g. "today", "p1", "##Work", "(today | overdue) & p1"), or a saved filter by ID or name (\`filterIdOrName\`). Requires at least one search parameter. \`filter\`/\`filterIdOrName\` cannot be combined with projectId/sectionId/parentId, and \`filter\` and \`filterIdOrName\` are mutually exclusive.
- **find-tasks-by-date**: Get tasks by date range (startDate: YYYY-MM-DD or 'today' which includes overdue tasks) or specific day counts
- **find-completed-tasks**: View completed tasks by completion date or original due date; if since/until are omitted, defaults to the last 7 days (returns all collaborators unless filtered). For a history of actual task-completion events, including recurring task occurrences, use find-activity instead.

**Project & Organization:**
- **add-projects/update-projects/find-projects**: Manage project lifecycle with names, descriptions (Markdown), favorites, view styles (list/board/calendar), and workspace assignment for new projects (by name or ID). find-projects returns active projects by default; pass archivedStatus ('archived' or 'all') to include archived projects. Every returned project includes an isArchived field
- **project-management**: Archive or unarchive projects by ID
- To delete a project (active or archived), use **delete-object** with type "project". Note: workspace projects must be archived first; personal projects can be deleted regardless
- **project-move**: Move projects between personal and workspace contexts
- **add-sections/update-sections/find-sections**: Organize tasks within projects using sections
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

**Templates:**
- **export-project-template**: Export a project as a Todoist template — CSV content (format "file") or a shareable link (format "url"). Prefer "url" for large projects. To read a project's contents rather than export it, use find-tasks.
- **import-project-template**: Add a template's tasks, sections and comments to an existing project. Source it with templateId (a gallery slug like "product-launch", a personal template ID like "UT_28Ex...", or a full Todoist template URL) or with csvFileContent (CSV from export-project-template). Templates cannot be listed through this server, so only use the ID or URL the user gave you. Gallery templates work for any account; personal templates only for the account that saved them. For "start a new project from this template", call add-projects first and import into the new project. Imports write immediately and cannot be undone.

**Activity & Audit:**
- **find-activity**: Retrieve activity logs to monitor and audit changes. Shows events from all users by default; use initiatorId to filter by specific user. Filter by object type (task/project/comment), event type (added/updated/deleted/completed/uncompleted/archived/unarchived/shared/left), objects (objectId, projectId, taskId), and an inclusive dateFrom/exclusive dateTo range. For “what did I complete?” or “what got done?” questions, including recurring task occurrences, use objectType="task", eventType="completed", and the requested date range. Activity history retention depends on the user plan.
- **get-productivity-stats**: Get comprehensive productivity statistics including daily/weekly completion breakdowns, goal streaks (current, last, max), karma score and trends, and historical karma data. No parameters required.

**Project Health & Insights:**
- **get-project-health**: Get comprehensive health assessment for a project including completion progress (completed/active counts, percentage), health status (EXCELLENT/ON_TRACK/AT_RISK/CRITICAL), description, and task-level recommendations. Use includeContext=true for detailed metrics (overdue tasks, weekly activity, avg completion time) and full task data. Health data may be stale — check isStale flag.
- **get-project-activity-stats**: Get daily and optional weekly activity statistics for a project over a configurable time window (1-12 weeks). Useful for identifying activity trends.
- **analyze-project-health**: Trigger a new health analysis for a project. Use when health data is stale. The analysis may take time — use get-project-health afterward to see updated results.
- **get-workspace-insights**: Get aggregated health and progress insights across all projects in a workspace. Accepts workspace name or ID, with optional project ID filtering.

**General Operations:**
- **delete-object**: Remove projects, sections, tasks, comments, labels, filters, reminders, or location reminders by type and ID. Deletes both active and archived projects (workspace projects must be archived first; use find-projects with archivedStatus to locate archived projects)
- **fetch-object**: Fetch a single task, project, comment, or section by its ID. Pass includeChildren=true to also get its direct children (subtasks for a task, sub-projects for a project) with a childCount - use this to check whether a task hides subtasks rather than a speculative find-tasks call
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
- **Completion History**: find-activity with objectType="task", eventType="completed", dateFrom, and dateTo to report what was actually completed in a period, including recurring task occurrences; use initiatorId for one collaborator
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
    registerTaskListApp(server)

    /**
     * Tools
     *
     * The surface is defined by `registeredTools`; see `tool-registry.ts`.
     */
    const toolArgs = { server, client: todoist, features }

    for (const tool of registeredTools) {
        registerTool({ tool, ...toolArgs })
    }

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
