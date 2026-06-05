import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('registerTaskListApp', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it('registers the real task list HTML when imported from source', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const registerResourceSpy = vi.spyOn(McpServer.prototype, 'registerResource')
        const { registerTaskListApp, taskListResourceUri } = await import('./resources.js')

        const server = new McpServer({ name: 'test-server', version: '1.0.0' })
        registerTaskListApp(server)

        expect(consoleErrorSpy).not.toHaveBeenCalled()
        expect(registerResourceSpy).toHaveBeenCalledTimes(2)
        expect(registerResourceSpy.mock.calls[0]?.[2]).toMatchObject({
            description: 'Interactive task list widget',
            _meta: {
                ui: {
                    prefersBorder: true,
                    csp: {
                        connectDomains: [],
                        resourceDomains: [],
                    },
                },
                'openai/widgetDescription': 'Interactive task list widget',
                'openai/widgetPrefersBorder': true,
                'openai/widgetCSP': {
                    connect_domains: [],
                    resource_domains: [],
                },
                'openai/widgetDomain': 'https://ai.todoist.net',
            },
        })

        const readCallback = registerResourceSpy.mock.calls[0]?.[3] as
            | (() => Promise<{ contents: Array<{ uri: string; text: string; _meta?: unknown }> }>)
            | undefined

        expect(readCallback).toBeDefined()
        if (!readCallback) {
            throw new Error('registerResource callback was not captured')
        }

        const result = await readCallback()
        const registerConfigMeta = registerResourceSpy.mock.calls[0]?.[2]?._meta as
            | { ui?: Record<string, unknown> }
            | undefined

        expect(result.contents).toHaveLength(1)
        expect(result.contents[0]?.uri).toBe(taskListResourceUri)
        expect(result.contents[0]?.text).toContain('<div id="root"></div>')
        expect(result.contents[0]?.text).toContain(
            '<script type="module" src="/main.tsx"></script>',
        )
        expect(registerConfigMeta?.ui).not.toHaveProperty('domain')
        expect(result.contents[0]?._meta).toMatchObject({
            ui: {
                prefersBorder: true,
                csp: {
                    connectDomains: [],
                    resourceDomains: [],
                },
            },
            'openai/widgetDescription': 'Interactive task list widget',
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': {
                connect_domains: [],
                resource_domains: [],
            },
            'openai/widgetDomain': 'https://ai.todoist.net',
        })
        expect(
            (result.contents[0]?._meta as { ui?: Record<string, unknown> } | undefined)?.ui,
        ).not.toHaveProperty('domain')

        const fallbackTemplate = registerResourceSpy.mock.calls[1]?.[1] as
            | { uriTemplate?: { toString: () => string } }
            | undefined
        const fallbackConfig = registerResourceSpy.mock.calls[1]?.[2]
        const fallbackReadCallback = registerResourceSpy.mock.calls[1]?.[3] as
            | ((uri: URL) => Promise<{ contents: Array<{ uri: string; text: string }> }>)
            | undefined

        expect(fallbackTemplate?.uriTemplate?.toString()).toBe('ui://todoist/task-list@{hash}')
        expect(fallbackConfig).toMatchObject({
            description: 'Interactive task list widget compatibility fallback',
            mimeType: 'text/html;profile=mcp-app',
            _meta: {
                ui: {
                    prefersBorder: true,
                    csp: {
                        connectDomains: [],
                        resourceDomains: [],
                    },
                },
                'openai/widgetDescription': 'Interactive task list widget',
                'openai/widgetPrefersBorder': true,
                'openai/widgetCSP': {
                    connect_domains: [],
                    resource_domains: [],
                },
                'openai/widgetDomain': 'https://ai.todoist.net',
            },
        })

        expect(fallbackReadCallback).toBeDefined()
        if (!fallbackReadCallback) {
            throw new Error('fallback registerResource callback was not captured')
        }

        const staleUri = 'ui://todoist/task-list@stale1234567'
        const fallbackResult = await fallbackReadCallback(new URL(staleUri))

        expect(fallbackResult.contents).toHaveLength(1)
        expect(fallbackResult.contents[0]?.uri).toBe(staleUri)
        expect(fallbackResult.contents[0]?.text).toContain('<div id="root"></div>')
    })
})
