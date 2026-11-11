import type { McpServer } from '@modelcontextprotocol/server'
import { createToolRegistrar } from '@todoist/mcp-core'
import type { TodoistApi } from '@todoist/sdk'
import type { AnyTodoistTool } from './todoist-tool.js'
import { formatToolExecutionError } from './tool-execution-error.js'
import { runWithUsageTrackingContext } from './usage-tracking.js'
import { executeWithRetry } from './utils/retry.js'
import { ToolNames } from './utils/tool-names.js'

/**
 * Supported feature names that modify tool behavior.
 *
 * Currently supported:
 * - `'strip_emails'`: Strips email addresses from collaborator tool outputs
 *   (affects: find-project-collaborators, find-completed-tasks). Useful for
 *   clients like ChatGPT that should not have access to user emails.
 */
const FEATURE_NAMES = {
    /**
     * Strips email addresses from tool outputs that expose user data.
     * Affects: find-project-collaborators, find-completed-tasks
     */
    STRIP_EMAILS: 'strip_emails',
} as const

/**
 * Valid feature name values.
 * @see FEATURE_NAMES for available options with documentation.
 */
type FeatureName = (typeof FEATURE_NAMES)[keyof typeof FEATURE_NAMES]

/**
 * A feature that modifies tool behavior.
 */
type Feature = {
    /**
     * The feature name. Use {@link FEATURE_NAMES} for available options with intellisense.
     */
    name: FeatureName
}

/**
 * Array of features to enable when creating the MCP server.
 */
type Features = Feature[]

/**
 * Whether to return the structured content directly, vs. in the `content` part of the output.
 *
 * The `structuredContent` part of the output is relatively new in the spec, and it's not yet
 * supported by all clients. This flag controls wether we return the structured content using this
 * new feature of the MCP protocol or not.
 *
 * If `false`, the `structuredContent` will also be returned as stringified JSON in one of the
 * `content` parts.
 *
 * Eventually we should be able to remove this, and change the code to always work with the
 * structured content returned directly, once most or all MCP clients support it.
 */
const USE_STRUCTURED_CONTENT =
    process.env.USE_STRUCTURED_CONTENT === 'true' || process.env.NODE_ENV === 'test'

// Argument names whose values carry user content rather than identifiers, and so
// must not reach server logs when a tool throws.
const REDACTED_ARG_KEYS = new Set(['file'])

function redactArgs(args: unknown): unknown {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return args
    }

    return Object.fromEntries(
        Object.entries(args as Record<string, unknown>).map(([key, value]) =>
            REDACTED_ARG_KEYS.has(key) && value !== undefined ? [key, '[redacted]'] : [key, value],
        ),
    )
}

/**
 * Tools that expose user emails in their outputs.
 * When adding new tools that return user emails, update this list
 * and the FeatureFlags.stripEmails JSDoc.
 */
const TOOLS_WITH_USER_EMAILS = [
    ToolNames.FIND_PROJECT_COLLABORATORS,
    ToolNames.FIND_COMPLETED_TASKS,
] as const

/**
 * Recursively strips email fields from an object structure.
 * Used to remove sensitive email data from tool outputs for certain clients.
 */
function stripEmailsFromObject<T>(obj: T): T {
    if (obj === null || obj === undefined) {
        return obj
    }

    if (Array.isArray(obj)) {
        return obj.map((item) => stripEmailsFromObject(item)) as T
    }

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            if (key === 'email') {
                // Skip email fields entirely
                continue
            }
            result[key] = stripEmailsFromObject(value)
        }
        return result as T
    }

    return obj
}

/**
 * Strips email patterns from text content.
 * Replaces email addresses with [email hidden] placeholder.
 */
function stripEmailsFromText(text: string): string {
    // Pattern matches common email formats in the tool output
    // e.g., "• John Doe (john@example.com) - ID: 123" -> "• John Doe - ID: 123"
    // Also handles standalone email references
    const emailInParensPattern = /\s*\([^)]*@[^)]+\)/g
    const emailPattern = /\S+@\S+\.\S+/g

    return text.replace(emailInParensPattern, '').replace(emailPattern, '[email hidden]')
}

function exposesUserEmails(toolName: string): boolean {
    return TOOLS_WITH_USER_EMAILS.includes(toolName as (typeof TOOLS_WITH_USER_EMAILS)[number])
}

/**
 * Register Todoist tools in an MCP server.
 *
 * Schema caching, annotations, MCP Apps `_meta`, result shaping and turning a thrown error into
 * an error result come from `@todoist/mcp-core`. What is Todoist's own is wired in here: the API
 * client, retries, usage tracking, `strip_emails`, and the API error formatting. One registrar
 * serves every tool, since none of that depends on the tool.
 */
function registerTools({
    tools,
    server,
    client,
    features = [],
}: {
    tools: readonly AnyTodoistTool[]
    server: McpServer
    client: TodoistApi
    features?: Features
}) {
    const stripEmails = features.some((f) => f.name === 'strip_emails')

    const register = createToolRegistrar<TodoistApi>({
        titlePrefix: 'Todoist',
        createContext: () => client,
        formatError: formatToolExecutionError,
        structuredContentAsText: !USE_STRUCTURED_CONTENT,
        wrapExecute: async (tool, run) => {
            const result = await runWithUsageTrackingContext(tool.name, () => executeWithRetry(run))
            if (!stripEmails || !exposesUserEmails(tool.name)) {
                return result
            }

            // Strip emails from outputs for ChatGPT clients on collaborator-related tools
            return {
                ...result,
                textContent: result.textContent && stripEmailsFromText(result.textContent),
                structuredContent:
                    result.structuredContent && stripEmailsFromObject(result.structuredContent),
            }
        },
        onError: ({ tool, args, error }) => {
            console.error(`Error executing tool ${tool.name}:`, { args: redactArgs(args), error })
        },
    })

    for (const tool of tools) {
        register(server, tool)
    }
}

export {
    FEATURE_NAMES,
    type Feature,
    type FeatureName,
    type Features,
    registerTools,
    stripEmailsFromObject,
    stripEmailsFromText,
}
