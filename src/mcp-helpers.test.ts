import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerTool, stripEmailsFromObject, stripEmailsFromText } from './mcp-helpers.js'

type RegisterToolArgs = Parameters<typeof registerTool>[0]
type ToolFixture = RegisterToolArgs['tool']

/**
 * Build a minimal `TodoistTool` fixture for `registerTool` tests. Returns a
 * shared scaffold (parameters, annotations, server/client casts) so individual
 * tests only have to specify the bits they actually exercise.
 */
function buildToolFixture(overrides: {
    name?: string
    description?: string
    outputSchema?: Record<string, unknown>
    execute: ToolFixture['execute']
}): ToolFixture {
    const { name = 'test-tool', description = 'Test tool', outputSchema, execute } = overrides

    return {
        name,
        description,
        parameters: {},
        ...(outputSchema ? { outputSchema } : {}),
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
        },
        execute,
    } as unknown as ToolFixture
}

/**
 * Capture the callback `registerTool` registers with the MCP server.
 */
function captureRegisterToolMock() {
    const mock = vi.fn()
    const server = { registerTool: mock } as unknown as RegisterToolArgs['server']
    const client = {} as RegisterToolArgs['client']
    return { mock, server, client }
}

describe('stripEmailsFromObject', () => {
    it.each([
        [
            { id: '1', name: 'John', email: 'john@example.com' },
            { id: '1', name: 'John' },
        ],
        [
            {
                collaborators: [
                    { id: '1', name: 'Alice', email: 'alice@example.com' },
                    { id: '2', name: 'Bob', email: 'bob@example.com' },
                ],
            },
            {
                collaborators: [
                    { id: '1', name: 'Alice' },
                    { id: '2', name: 'Bob' },
                ],
            },
        ],
        [
            { collaborators: [], totalCount: 0 },
            { collaborators: [], totalCount: 0 },
        ],
        [
            { level1: { level2: { user: { id: '1', email: 'deep@example.com', name: 'Deep' } } } },
            { level1: { level2: { user: { id: '1', name: 'Deep' } } } },
        ],
    ])('strips email fields from %j', (input, expected) => {
        expect(stripEmailsFromObject(input)).toEqual(expected)
    })

    it.each([null, undefined, 'string', 123, true])('preserves primitive value %p', (value) => {
        expect(stripEmailsFromObject(value)).toBe(value)
    })
})

describe('stripEmailsFromText', () => {
    it.each([
        ['• John (john@example.com) - ID: 123', '• John - ID: 123'],
        ['• Alice (alice@example.com)\n• Bob (bob@example.com)', '• Alice\n• Bob'],
        ['Contact at john@example.com', 'Contact at [email hidden]'],
        ['User (test@domain.com) and contact@another.org', 'User and [email hidden]'],
        ['Plain text without emails', 'Plain text without emails'],
        ['assigned to: user@example.com', 'assigned to: [email hidden]'],
        ['', ''],
    ])('transforms %j to %j', (input, expected) => {
        expect(stripEmailsFromText(input)).toBe(expected)
    })
})

describe('registerTool config', () => {
    it('omits outputSchema when the tool does not declare one', () => {
        const { mock, server, client } = captureRegisterToolMock()

        registerTool({
            tool: buildToolFixture({
                name: 'no-schema-tool',
                description: 'Tool without output schema',
                execute: async () => ({ textContent: 'ok' }),
            }),
            server,
            client,
        })

        expect(mock).toHaveBeenCalledTimes(1)
        const config = mock.mock.calls[0]?.[1] as Record<string, unknown>
        expect(Object.hasOwn(config, 'outputSchema')).toBe(false)
    })

    it('includes outputSchema when the tool declares one', () => {
        const { mock, server, client } = captureRegisterToolMock()
        const outputSchema = {}

        registerTool({
            tool: buildToolFixture({
                name: 'schema-tool',
                description: 'Tool with output schema',
                outputSchema,
                execute: async () => ({ textContent: 'ok' }),
            }),
            server,
            client,
        })

        const config = mock.mock.calls[0]?.[1] as Record<string, unknown>
        expect(config.outputSchema).toBe(outputSchema)
    })
})

describe('registerTool error path', () => {
    it('applies centralized API formatting in MCP callback errors', async () => {
        const { mock, server, client } = captureRegisterToolMock()

        registerTool({
            tool: buildToolFixture({
                outputSchema: {},
                execute: async () => {
                    throw {
                        httpStatusCode: 500,
                        responseData: {
                            error: 'Internal API failure',
                        },
                    }
                },
            }),
            server,
            client,
        })

        expect(mock).toHaveBeenCalledTimes(1)

        const callback = mock.mock.calls[0]?.[2] as (
            args: Record<string, unknown>,
            context: unknown,
        ) => Promise<{
            content: Array<{ text: string }>
            isError: boolean
        }>

        const output = await callback({}, {})

        expect(output.isError).toBe(true)
        expect(output.content[0]?.text).toContain('Todoist API request failed (HTTP 500).')
        expect(output.content[0]?.text).toContain(
            'Try next: Todoist API may be temporarily unavailable. Retry shortly.',
        )
    })
})

describe('registerTool content ordering', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    type InvokeArgs = {
        textContent?: string
        structuredContent?: Record<string, unknown>
        contentItems?: ContentBlock[]
    }

    async function invokeCallback({ textContent, structuredContent, contentItems }: InvokeArgs) {
        // resetModules() before the import so the freshly-stubbed env vars
        // are read at module evaluation (the USE_STRUCTURED_CONTENT and
        // NODE_ENV checks both run at import time).
        vi.resetModules()
        const { registerTool: registerToolFresh } = await import('./mcp-helpers.js')
        const { mock, server, client } = captureRegisterToolMock()

        registerToolFresh({
            tool: buildToolFixture({
                name: 'ordering-tool',
                outputSchema: {},
                execute: async () => ({ textContent, structuredContent, contentItems }),
            }),
            server,
            client,
        })

        const callback = mock.mock.calls[0]?.[2] as (
            args: Record<string, unknown>,
            context: unknown,
        ) => Promise<{
            content?: ContentBlock[]
            structuredContent?: Record<string, unknown>
        }>

        return callback({}, {})
    }

    it('puts stringified JSON first and human summary last in legacy content mode', async () => {
        // Simulate production default: USE_STRUCTURED_CONTENT unset, NODE_ENV != 'test'.
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('USE_STRUCTURED_CONTENT', '')

        const structuredContent = { tasks: [{ id: '1', title: 'Buy milk' }], totalCount: 1 }
        const output = await invokeCallback({
            textContent: 'Tasks matching filter: 1.',
            structuredContent,
        })

        expect(output.structuredContent).toEqual(structuredContent)
        const content = output.content ?? []
        expect(content).toHaveLength(2)

        // content[0] is the stringified JSON — surfaces to clients that only
        // read the first block (e.g. OpenAI Responses API).
        const first = content[0] as { type: string; text: string }
        expect(first.type).toBe('text')
        expect(JSON.parse(first.text)).toEqual(structuredContent)

        // Last block is the prose summary.
        const last = content[content.length - 1] as { type: string; text: string }
        expect(last.text).toBe('Tasks matching filter: 1.')
    })

    it('keeps contentItems ahead of the JSON dup and summary in legacy content mode', async () => {
        // Same production-default env: USE_STRUCTURED_CONTENT off, not in test mode.
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('USE_STRUCTURED_CONTENT', '')

        const structuredContent = { fileName: 'attachment.png' }
        const image: ContentBlock = {
            type: 'image',
            data: 'base64data',
            mimeType: 'image/png',
        }

        const output = await invokeCallback({
            textContent: 'Attachment: attachment.png',
            structuredContent,
            contentItems: [image],
        })

        const content = output.content ?? []
        expect(content).toHaveLength(3)

        // Order: tool-authored contentItem first, then JSON dup, then prose summary.
        expect(content[0]).toEqual(image)
        const json = content[1] as { type: string; text: string }
        expect(json.type).toBe('text')
        expect(JSON.parse(json.text)).toEqual(structuredContent)
        const summary = content[2] as { type: string; text: string }
        expect(summary.text).toBe('Attachment: attachment.png')
    })

    it('omits the JSON dup block when USE_STRUCTURED_CONTENT mode is on', async () => {
        // Stub NODE_ENV explicitly so the assertion exercises the env-flag
        // branch (USE_STRUCTURED_CONTENT='true') rather than relying on the
        // vitest default of NODE_ENV='test', which also enables the branch.
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('USE_STRUCTURED_CONTENT', 'true')

        const structuredContent = { tasks: [], totalCount: 0 }
        const output = await invokeCallback({
            textContent: 'No tasks.',
            structuredContent,
        })

        expect(output.structuredContent).toEqual(structuredContent)
        const content = output.content ?? []
        expect(content).toHaveLength(1)
        const only = content[0] as { type: string; text: string }
        expect(only.text).toBe('No tasks.')
    })
})
