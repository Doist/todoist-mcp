import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerTool, stripEmailsFromObject, stripEmailsFromText } from './mcp-helpers.js'

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
        const registerToolMock = vi.fn()

        registerTool({
            tool: {
                name: 'no-schema-tool',
                description: 'Tool without output schema',
                parameters: {},
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                },
                execute: async () => ({ textContent: 'ok' }),
            },
            server: {
                registerTool: registerToolMock,
            } as unknown as Parameters<typeof registerTool>[0]['server'],
            client: {} as Parameters<typeof registerTool>[0]['client'],
        })

        expect(registerToolMock).toHaveBeenCalledTimes(1)
        const config = registerToolMock.mock.calls[0]?.[1] as Record<string, unknown>
        expect(Object.hasOwn(config, 'outputSchema')).toBe(false)
    })

    it('includes outputSchema when the tool declares one', () => {
        const registerToolMock = vi.fn()
        const outputSchema = {}

        registerTool({
            tool: {
                name: 'schema-tool',
                description: 'Tool with output schema',
                parameters: {},
                outputSchema,
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                },
                execute: async () => ({ textContent: 'ok' }),
            },
            server: {
                registerTool: registerToolMock,
            } as unknown as Parameters<typeof registerTool>[0]['server'],
            client: {} as Parameters<typeof registerTool>[0]['client'],
        })

        const config = registerToolMock.mock.calls[0]?.[1] as Record<string, unknown>
        expect(config.outputSchema).toBe(outputSchema)
    })
})

describe('registerTool error path', () => {
    it('applies centralized API formatting in MCP callback errors', async () => {
        const registerToolMock = vi.fn()

        registerTool({
            tool: {
                name: 'test-tool',
                description: 'Test tool',
                parameters: {},
                outputSchema: {},
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                },
                execute: async () => {
                    throw {
                        httpStatusCode: 500,
                        responseData: {
                            error: 'Internal API failure',
                        },
                    }
                },
            },
            server: {
                registerTool: registerToolMock,
            } as unknown as Parameters<typeof registerTool>[0]['server'],
            client: {} as Parameters<typeof registerTool>[0]['client'],
        })

        expect(registerToolMock).toHaveBeenCalledTimes(1)

        const callback = registerToolMock.mock.calls[0]?.[2] as (
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

    async function invokeCallback({
        textContent,
        structuredContent,
    }: {
        textContent?: string
        structuredContent?: Record<string, unknown>
    }) {
        vi.resetModules()
        const { registerTool: registerToolFresh } = await import('./mcp-helpers.js')
        const registerToolMock = vi.fn()

        registerToolFresh({
            tool: {
                name: 'ordering-tool',
                description: 'Tool for ordering tests',
                parameters: {},
                outputSchema: {},
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    idempotentHint: true,
                },
                execute: async () => ({ textContent, structuredContent }),
            } as unknown as Parameters<typeof registerToolFresh>[0]['tool'],
            server: {
                registerTool: registerToolMock,
            } as unknown as Parameters<typeof registerToolFresh>[0]['server'],
            client: {} as Parameters<typeof registerToolFresh>[0]['client'],
        })

        const callback = registerToolMock.mock.calls[0]?.[2] as (
            args: Record<string, unknown>,
            context: unknown,
        ) => Promise<{
            content?: Array<{ type: string; text: string }>
            structuredContent?: Record<string, unknown>
        }>

        return callback({}, {})
    }

    it('puts stringified JSON first and human summary last when legacy content mode is on', async () => {
        // Simulate production default: USE_STRUCTURED_CONTENT unset, NODE_ENV != 'test'
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('USE_STRUCTURED_CONTENT', '')

        const structuredContent = { tasks: [{ id: '1', title: 'Buy milk' }], totalCount: 1 }
        const output = await invokeCallback({
            textContent: 'Tasks matching filter: 1.',
            structuredContent,
        })

        expect(output.structuredContent).toEqual(structuredContent)
        expect(output.content).toBeDefined()
        const content = output.content ?? []
        expect(content.length).toBe(2)

        // content[0] is the stringified JSON — surfaces to clients that only
        // read the first block (e.g. OpenAI Responses API).
        expect(content[0]?.type).toBe('text')
        expect(JSON.parse(content[0]?.text ?? '')).toEqual(structuredContent)

        // Last block is the prose summary.
        expect(content[content.length - 1]?.text).toBe('Tasks matching filter: 1.')
    })

    it('omits the JSON dup block when USE_STRUCTURED_CONTENT mode is on', async () => {
        vi.stubEnv('USE_STRUCTURED_CONTENT', 'true')

        const structuredContent = { tasks: [], totalCount: 0 }
        const output = await invokeCallback({
            textContent: 'No tasks.',
            structuredContent,
        })

        expect(output.structuredContent).toEqual(structuredContent)
        const content = output.content ?? []
        expect(content.length).toBe(1)
        expect(content[0]?.text).toBe('No tasks.')
    })
})
