import type { TodoistApi } from '@doist/todoist-sdk'
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ContentBlock, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { AnyTodoistTool, ExecuteResult } from './todoist-tool.js'
import { formatToolExecutionError } from './tool-execution-error.js'
import { runWithUsageTrackingContext } from './usage-tracking.js'
import { executeWithRetry } from './utils/retry.js'
import { removeNullFields } from './utils/sanitize-data.js'
import { ToolNames } from './utils/tool-names.js'

/**
 * Supported feature names that modify tool behavior.
 *
 * Currently supported:
 * - `'strip_emails'`: Strips email addresses from collaborator tool outputs
 *   (affects: find-project-collaborators, find-completed-tasks). Useful for
 *   clients like ChatGPT that should not have access to user emails.
 * - `'output_schemas'`: Advertises every tool's output schema, rather than only
 *   those needed to render a widget.
 */
const FEATURE_NAMES = {
    /**
     * Strips email addresses from tool outputs that expose user data.
     * Affects: find-project-collaborators, find-completed-tasks
     */
    STRIP_EMAILS: 'strip_emails',

    /**
     * Advertises `outputSchema` on every tool that declares one.
     *
     * Output schemas are more than half the fixed cost of `tools/list`, so by
     * default only widget-backed tools advertise one — a client needs the schema
     * to render a widget, but not to read a result. Tools return
     * `structuredContent` either way.
     *
     * Enable this for a consumer that reads the schema itself rather than just
     * calling tools: code generation, for instance, where something has to know
     * a result's field names in order to reference them.
     */
    OUTPUT_SCHEMAS: 'output_schemas',
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

type AppToolMeta =
    | ({ ui: Record<string, unknown> } & Record<string, unknown>)
    | ({ 'ui/resourceUri': string } & Record<string, unknown>)

/**
 * Whether to return the structured content directly, vs. in the `content` part of the output.
 *
 * The `structuredContent` part of the output is relatively new in the spec, and it's not yet
 * supported by all clients. This flag controls wether we return the structured content using this
 * new feature of the MCP protocol or not.
 *
 * If `false`, the `structuredContent` will be returned as stringified JSON in one of the `content`
 * parts.
 *
 * Eventually we should be able to remove this, and change the code to always work with the
 * structured content returned directly, once most or all MCP clients support it.
 */
const USE_STRUCTURED_CONTENT =
    process.env.USE_STRUCTURED_CONTENT === 'true' || process.env.NODE_ENV === 'test'

/**
 * Get the output payload for a tool, in the correct format expected by MCP client apps.
 *
 * @param textContent - The text content to return.
 * @param structuredContent - The structured content to return.
 * @returns The output payload.
 * @see USE_STRUCTURED_CONTENT - Whether to use the structured content feature of the MCP protocol.
 */
function getToolOutput<StructuredContent extends Record<string, unknown>>({
    textContent,
    structuredContent,
    contentItems,
}: {
    textContent: string | undefined
    structuredContent: StructuredContent | undefined
    contentItems?: ContentBlock[]
}) {
    // Remove null fields from structured content before returning
    const sanitizedContent = removeNullFields(structuredContent)

    // Always include structuredContent when available since all tools have outputSchema
    const result: Record<string, unknown> = {}

    const contentArray: Array<Record<string, unknown>> = []

    // Tool-authored content items (images, embedded resources) come first
    // so they retain primacy for clients that read content[0].
    if (contentItems) {
        contentArray.push(...contentItems)
    }

    // Stringified JSON ahead of the prose summary so clients that only surface
    // a text-type content[0] (e.g. OpenAI Responses API, which strips
    // structuredContent) get the structured payload rather than the summary.
    if (!USE_STRUCTURED_CONTENT && structuredContent) {
        contentArray.push({
            type: 'text' as const,
            text: JSON.stringify(sanitizedContent),
        })
    }

    if (textContent) {
        contentArray.push({ type: 'text' as const, text: textContent })
    }

    if (contentArray.length > 0) {
        result.content = contentArray
    }

    if (structuredContent) result.structuredContent = sanitizedContent

    return result
}

function getErrorOutput(error: string) {
    return {
        content: [{ type: 'text' as const, text: error }],
        isError: true,
    }
}

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
 * Build MCP ToolAnnotations for a tool.
 *
 * @param tool - The tool information used for annotation generation.
 * @returns MCP annotations.
 */
function getMcpAnnotations(tool: { name: string; annotations: ToolAnnotations }): ToolAnnotations {
    const defaultAnnotations: ToolAnnotations = {
        title: `Todoist: ${formatToolTitle(tool.name)}`,
        openWorldHint: false,
    }

    return { ...defaultAnnotations, ...tool.annotations }
}

function formatToolTitle(toolName: string): string {
    return toolName
        .split('-')
        .filter(Boolean)
        .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
        .join(' ')
}

function hasAppUiMeta(meta: Record<string, unknown> | undefined): meta is AppToolMeta {
    if (!meta) {
        return false
    }

    if (typeof meta['ui/resourceUri'] === 'string') {
        return true
    }

    return typeof meta.ui === 'object' && meta.ui !== null
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

/**
 * Check a tool's output against its declared schema, in tests only.
 *
 * The SDK validates `structuredContent` against a tool's `outputSchema`, but
 * only for tools that advertise one — and most no longer do, to keep them out
 * of the `tools/list` payload. Tool definitions still carry their schema, so
 * this keeps that check where mismatches are worth catching: a schema that has
 * drifted from what the tool actually returns fails CI rather than reaching a
 * client. Production pays nothing.
 *
 * @throws if the output does not match the tool's declared `outputSchema`.
 */
function assertStructuredContentMatchesSchema(
    tool: AnyTodoistTool,
    structuredContent: Record<string, unknown> | undefined,
) {
    if (process.env.NODE_ENV !== 'test' || !tool.outputSchema || !structuredContent) {
        return
    }

    const result = z.object(tool.outputSchema).safeParse(structuredContent)
    if (!result.success) {
        throw new Error(
            `Tool ${tool.name} returned structuredContent that does not match its outputSchema: ${result.error.message}`,
        )
    }
}

/**
 * Register a Todoist tool in an MCP server.
 */
function registerTool({
    tool,
    server,
    client,
    features = [],
}: {
    tool: AnyTodoistTool
    server: McpServer
    client: TodoistApi
    features?: Features
}) {
    const shouldStripEmails =
        features.some((f) => f.name === 'strip_emails') &&
        TOOLS_WITH_USER_EMAILS.includes(tool.name as (typeof TOOLS_WITH_USER_EMAILS)[number])

    // `AnyTodoistTool` declares `args` as `never` so that tools of every
    // parameter shape can be held in one collection. Widening it back is safe
    // here and only here: the SDK has already validated `args` against this
    // tool's own `inputSchema` before invoking the callback.
    const execute = tool.execute as (
        args: Record<string, unknown>,
        client: TodoistApi,
    ) => ExecuteResult<z.ZodRawShape>

    // `getToolOutput` assembles its result incrementally and so is typed as a
    // plain record, which does not structurally match `CallToolResult` (that
    // requires `content`). The values it produces are valid results; only the
    // static shape is looser.
    // @ts-expect-error see above
    const cb: ToolCallback<z.ZodRawShape> = async (args, _context) => {
        try {
            let { textContent, structuredContent, contentItems } =
                await runWithUsageTrackingContext(tool.name, () =>
                    executeWithRetry(() => execute(args, client)),
                )

            assertStructuredContentMatchesSchema(tool, structuredContent)

            // Strip emails from outputs for ChatGPT clients on collaborator-related tools
            if (shouldStripEmails) {
                if (textContent) {
                    textContent = stripEmailsFromText(textContent)
                }
                if (structuredContent) {
                    structuredContent = stripEmailsFromObject(structuredContent)
                }
            }

            return getToolOutput({ textContent, structuredContent, contentItems })
        } catch (error) {
            console.error(`Error executing tool ${tool.name}:`, { args: redactArgs(args), error })
            return getErrorOutput(formatToolExecutionError(error))
        }
    }

    const appUiMeta = hasAppUiMeta(tool._meta) ? tool._meta : undefined

    // Output schemas are more than half the fixed cost of `tools/list`, and a
    // client only needs one to render a widget or to read the result shape
    // without calling the tool. Tools return `structuredContent` either way, so
    // by default only widget-backed tools pay for one; consumers that read
    // schemas ask for them with the `output_schemas` feature.
    const advertiseOutputSchema =
        Boolean(appUiMeta) || features.some((f) => f.name === FEATURE_NAMES.OUTPUT_SCHEMAS)

    const toolConfig = {
        description: tool.description,
        inputSchema: tool.parameters,
        ...(advertiseOutputSchema && tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: getMcpAnnotations(tool),
        ...(tool._meta ? { _meta: tool._meta } : {}),
    }

    if (appUiMeta) {
        registerAppTool(
            server,
            tool.name,
            {
                ...toolConfig,
                _meta: appUiMeta,
            },
            cb,
        )
        return
    }

    server.registerTool(tool.name, toolConfig, cb)
}

export {
    assertStructuredContentMatchesSchema,
    FEATURE_NAMES,
    type Feature,
    type FeatureName,
    type Features,
    hasAppUiMeta,
    registerTool,
    stripEmailsFromObject,
    stripEmailsFromText,
}
