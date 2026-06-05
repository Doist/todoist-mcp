import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server'
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TASK_LIST_HTML_PATHS = [
    join(__dirname, 'task-list', 'index.html'),
    join(__dirname, 'mcp-apps', 'index.html'),
]

const FALLBACK_TASK_LIST_HTML = `<!doctype html>
<html>
  <body>
    <p>Task list app is missing. Run "npm run build" to generate it.</p>
  </body>
</html>`

function loadTaskListHtml() {
    const loadErrors: unknown[] = []

    for (const path of TASK_LIST_HTML_PATHS) {
        try {
            return readFileSync(path, 'utf-8')
        } catch (error) {
            loadErrors.push(error)
        }
    }

    console.error('Failed to load task list app HTML from any known path:', loadErrors)
    return FALLBACK_TASK_LIST_HTML
}

const taskListHtml = loadTaskListHtml()
const taskListHash = createHash('sha256').update(taskListHtml).digest('hex').slice(0, 12)
const taskListResourceUri = `ui://todoist/task-list@${taskListHash}`
const taskListResourceUriTemplate = 'ui://todoist/task-list@{hash}'
const taskListResourceDescription = 'Interactive task list widget'
const taskListWidgetDomain = 'https://ai.todoist.net'
const taskListResourceMeta = {
    ui: {
        prefersBorder: true,
        csp: {
            // The widget is bundled into one HTML file and does not fetch or load external assets.
            connectDomains: [] as string[],
            resourceDomains: [] as string[],
        },
    },
    'openai/widgetDescription': taskListResourceDescription,
    'openai/widgetPrefersBorder': true,
    'openai/widgetCSP': {
        connect_domains: [] as string[],
        resource_domains: [] as string[],
    },
    'openai/widgetDomain': taskListWidgetDomain,
}

function createTaskListResourceResult(uri: string) {
    return {
        contents: [
            {
                uri,
                mimeType: RESOURCE_MIME_TYPE,
                text: taskListHtml,
                _meta: taskListResourceMeta,
            },
        ],
    }
}

/**
 * Register the task list MCP App resource on the server.
 */
function registerTaskListApp(server: McpServer) {
    registerAppResource(
        server,
        'todoist-task-list',
        taskListResourceUri,
        {
            description: taskListResourceDescription,
            _meta: taskListResourceMeta,
        },
        async () => createTaskListResourceResult(taskListResourceUri),
    )

    server.registerResource(
        'todoist-task-list-hash-fallback',
        new ResourceTemplate(taskListResourceUriTemplate, { list: undefined }),
        {
            description: `${taskListResourceDescription} compatibility fallback`,
            mimeType: RESOURCE_MIME_TYPE,
            _meta: taskListResourceMeta,
        },
        async (uri) => createTaskListResourceResult(uri.toString()),
    )
}

export { registerTaskListApp, taskListResourceUri }
