import type { TodoistApi } from '@doist/todoist-sdk'
import type { ContentBlock, ToolAnnotations } from '@modelcontextprotocol/server'
import type { z } from 'zod'

type ExecuteResult<Output extends z.ZodRawShape> = Promise<{
    textContent?: string
    structuredContent?: z.infer<z.ZodObject<Output>>
    contentItems?: ContentBlock[]
}>

type RequiredToolAnnotations = ToolAnnotations & {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
}

/**
 * A Todoist tool that can be used in an MCP server or other conversational AI interfaces.
 */
type TodoistTool<
    Params extends z.ZodRawShape,
    Output extends z.ZodRawShape = Record<string, never>,
> = {
    /**
     * The name of the tool.
     */
    name: string

    /**
     * The description of the tool. This is important for the LLM to understand what the tool does,
     * and how to use it.
     */
    description: string

    /**
     * The schema of the parameters of the tool.
     *
     * This is used to validate the parameters of the tool, as well as to let the LLM know what the
     * parameters are.
     */
    parameters: Params

    /**
     * The schema of the output of the tool.
     *
     * This is used to describe the structured output format that the tool will return.
     */
    outputSchema?: Output

    /**
     * MCP ToolAnnotations hints for this tool.
     */
    annotations: RequiredToolAnnotations

    /**
     * The meta data of the tool.
     *
     * This is used to store additional information about the tool.
     */
    _meta?: Record<string, unknown>

    /**
     * The function that executes the tool.
     *
     * This is the main function that will be called when the tool is used.
     *
     * @param args - The arguments of the tool.
     * @param client - The Todoist API client used to make requests to the Todoist API.
     * @returns The result of the tool.
     */
    execute: (args: z.infer<z.ZodObject<Params>>, client: TodoistApi) => ExecuteResult<Output>
}

/**
 * A tool of any parameter and output shape.
 *
 * `TodoistTool` is generic over its schemas, and `execute` is contravariant in
 * its argument, so no single instantiation of it accepts every tool. Declaring
 * the argument as `never` does: `never` is assignable to any parameter type, so
 * a tool taking concrete args satisfies this while a caller cannot invoke
 * `execute` without narrowing back to the real tool type first.
 *
 * Use this for collections that hold tools of mixed shapes. Individual tools
 * keep their precise types through their own `satisfies TodoistTool<...>`.
 */
type AnyTodoistTool = Omit<TodoistTool<z.ZodRawShape, z.ZodRawShape>, 'execute'> & {
    execute: (args: never, client: TodoistApi) => ExecuteResult<z.ZodRawShape>
}

export type { AnyTodoistTool, ExecuteResult, RequiredToolAnnotations, TodoistTool }
