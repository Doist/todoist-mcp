import type { TodoistApi } from '@doist/todoist-sdk'
import type { AnyMcpTool, ExecuteResult, McpTool, RequiredToolAnnotations } from '@todoist/mcp-core'
import type { z } from 'zod'

/**
 * A Todoist tool that can be used in an MCP server or other conversational AI interfaces: an
 * `McpTool` whose `execute` receives the Todoist API client.
 */
type TodoistTool<
    Params extends z.ZodRawShape,
    Output extends z.ZodRawShape = Record<string, never>,
> = McpTool<Params, Output, TodoistApi>

/**
 * A Todoist tool of any parameter and output shape, for collections that hold tools of mixed
 * shapes. Individual tools keep their precise types through their own `satisfies TodoistTool<...>`.
 */
type AnyTodoistTool = AnyMcpTool<TodoistApi>

export type { AnyTodoistTool, ExecuteResult, RequiredToolAnnotations, TodoistTool }
