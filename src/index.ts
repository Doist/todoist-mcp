import { TodoistApi } from '@doist/todoist-api-typescript'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAddCommentToProject } from './tools/add-comment-to-project.js'
import { registerAddCommentToTask } from './tools/add-comment-to-task.js'
import { registerAddComment } from './tools/add-comment.js'
import { registerAddLabel } from './tools/add-label.js'
import { registerAddProject } from './tools/add-project.js'
import { registerAddSection } from './tools/add-section.js'
import { registerAddTask } from './tools/add-task.js'
import { registerCloseTask } from './tools/close-task.js'
import { registerDeleteComment } from './tools/delete-comment.js'
import { registerDeleteLabel } from './tools/delete-label.js'
import { registerDeleteProject } from './tools/delete-project.js'
import { registerDeleteSection } from './tools/delete-section.js'
import { registerDeleteTask } from './tools/delete-task.js'
import { registerGetComment } from './tools/get-comment.js'
import { registerGetComments } from './tools/get-comments.js'
import { registerGetLabel } from './tools/get-label.js'
import { registerGetLabels } from './tools/get-labels.js'
import { registerGetProductivityStats } from './tools/get-productivity-stats.js'
import { registerGetProjectCollaborators } from './tools/get-project-collaborators.js'
import { registerGetProjectComments } from './tools/get-project-comments.js'
import { registerGetProject } from './tools/get-project.js'
import { registerGetProjects } from './tools/get-projects.js'
import { registerGetSection } from './tools/get-section.js'
import { registerGetSections } from './tools/get-sections.js'
import { registerGetSharedLabels } from './tools/get-shared-labels.js'
import { registerGetTaskComments } from './tools/get-task-comments.js'
import { registerGetTask } from './tools/get-task.js'
import { registerGetTasksByFilter } from './tools/get-tasks-by-filter.js'
import { registerGetTasksCompletedByCompletionDate } from './tools/get-tasks-completed-by-completion-date.js'
import { registerGetTasksCompletedByDueDate } from './tools/get-tasks-completed-by-due-date.js'
import { registerGetTasks } from './tools/get-tasks.js'
import { registerMoveTaskToParent } from './tools/move-task-to-parent.js'
import { registerMoveTaskToProject } from './tools/move-task-to-project.js'
import { registerMoveTaskToSection } from './tools/move-task-to-section.js'
import { registerMoveTasks } from './tools/move-tasks.js'
import { registerQuickAddTask } from './tools/quick-add-task.js'
import { registerRemoveSharedLabel } from './tools/remove-shared-label.js'
import { registerRenameSharedLabel } from './tools/rename-shared-label.js'
import { registerReopenTask } from './tools/reopen-task.js'
import { registerUpdateComment } from './tools/update-comment.js'
import { registerUpdateLabel } from './tools/update-label.js'
import { registerUpdateProject } from './tools/update-project.js'
import { registerUpdateSection } from './tools/update-section.js'
import { registerUpdateTask } from './tools/update-task.js'

if (!process.env.TODOIST_API_KEY) {
    throw new Error('TODOIST_API_KEY environment variable is required')
}

const api = new TodoistApi(process.env.TODOIST_API_KEY)

/* Create server instance */
const server = new McpServer({ name: 'todoist-mcp', version: '1.0.1' })

/* Register Todoist tools */

/* Projects */
registerAddProject(server, api)
registerGetProjects(server, api)
registerGetProject(server, api)
registerUpdateProject(server, api)
registerDeleteProject(server, api)
registerMoveTaskToParent(server, api)

/* Collaborators */
registerGetProjectCollaborators(server, api)

/* Tasks */
registerAddTask(server, api)
registerQuickAddTask(server, api)
registerGetTask(server, api)
registerGetTasks(server, api)
registerGetTasksCompletedByCompletionDate(server, api)
registerGetTasksCompletedByDueDate(server, api)
registerGetProductivityStats(server, api)
registerUpdateTask(server, api)
registerCloseTask(server, api)
registerMoveTaskToProject(server, api)
registerMoveTaskToSection(server, api)
registerMoveTasks(server, api)
registerDeleteTask(server, api)
registerReopenTask(server, api)
registerGetTasksByFilter(server, api)

/* Sections */
registerAddSection(server, api)
registerGetSection(server, api)
registerGetSections(server, api)
registerUpdateSection(server, api)
registerDeleteSection(server, api)

/* Comments */
registerAddComment(server, api)
registerAddCommentToProject(server, api)
registerAddCommentToTask(server, api)
registerGetComment(server, api)
registerGetComments(server, api)
registerUpdateComment(server, api)
registerDeleteComment(server, api)
registerGetTaskComments(server, api)
registerGetProjectComments(server, api)

/* Labels */
registerAddLabel(server, api)
registerDeleteLabel(server, api)
registerUpdateLabel(server, api)
registerGetLabel(server, api)
registerGetLabels(server, api)
registerGetSharedLabels(server, api)
registerRemoveSharedLabel(server, api)
registerRenameSharedLabel(server, api)

async function main() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('Todoist Agent Server running on stdio')
}

main().catch((error) => {
    console.error('Fatal error in main():', error)
    process.exit(1)
})
