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

### Choosing between tools

What each tool does and how to fill its parameters is in the tool's own description and input schema. This section covers only what those cannot: which tool to reach for, and how tools relate to each other.

**Dates**

- To move a task to a different date use **reschedule-tasks**, never **update-tasks**. update-tasks replaces the whole due string, which destroys recurrence on recurring tasks.
- Never send a task's existing projectId, sectionId or parentId back to **update-tasks** — those fields are treated as a move.
- All dates respect the user's timezone.

**Finding things**

- For "what did I complete?", use **find-activity** with objectType="task" and eventType="completed". It reports completion events, including each occurrence of a recurring task. **find-completed-tasks** lists completed tasks, which is not the same question.
- To resolve a person's name or email to a user ID, or to answer "who is X?", use **find-project-collaborators** with just a searchTerm. It covers every shared project you can access plus yourself, so an empty result means they collaborate on none of them — not that they do not exist.
- Before assigning work to someone, call **find-project-collaborators** again with the target projectId. Resolving an ID only proves they collaborate on *some* project you can see; assignment fails unless they collaborate on that one.
- To find out whether a task hides subtasks, use **fetch-object** with includeChildren rather than a speculative **find-tasks** call.
- Filter tasks by label **name**. Label IDs are only for **delete-object** and **update-labels**. Shared labels can be renamed but not recoloured, reordered or favourited.

**Deleting and archiving**

- **delete-object** removes every object type; there is no per-type delete tool. Reminders use type "reminder", location reminders "location_reminder".
- A workspace project must be archived with **project-management** before it can be deleted. A personal project can be deleted directly.

**Templates**

- Templates cannot be listed through this server, so only use an ID or URL the user gave you. To start a new project from one, call **add-projects** first and import into it. Imports write immediately and cannot be undone.

**Project health**

- Health data may be stale — check the isStale flag, and call **analyze-project-health** to refresh it before reading again.

**Batches**

- Prefer a batch tool over one call per item.
- Where a batch tool returns per-item \`failures\` alongside successes, one failure does not undo the rest: never retry the whole batch, re-send only the items whose failure reason is fixable. **reschedule-tasks** is the exception — it has no per-item failures and throws if any task fails, so retry it as a whole.

Use the **productivity-analysis** prompt for a combined productivity review — it pulls together user-info, get-productivity-stats and find-completed-tasks.

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
