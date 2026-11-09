import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { TokenValidationError } from '@doist/mcp-core/host'
import { vi } from 'vitest'

import packageJson from '../../package.json' with { type: 'json' }
import {
    resetDefaultDispatcherForTests,
    resetDispatcherModuleLoaderForTests,
    setDispatcherModuleLoaderForTests,
} from '../usage-tracking.js'
import { validateTodoistToken } from './validate-todoist-token.js'

type Received = { method?: string; url?: string; headers: IncomingHttpHeaders }

let server: Server
let baseUrl: string
let status: number
let received: Received[]

beforeAll(async () => {
    server = createServer((req, res) => {
        received.push({ method: req.method, url: req.url, headers: req.headers })
        // Not JSON: the verdict comes from the status alone, so nothing may parse the body.
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end('<html>not a user object')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
    status = 200
    received = []
})

describe('validateTodoistToken', () => {
    it('asks the user endpoint with the bearer token, tagged for usage tracking', async () => {
        await expect(validateTodoistToken('tok-123', baseUrl)).resolves.toBe('valid')

        expect(received).toHaveLength(1)
        expect(received[0]?.method).toBe('GET')
        expect(received[0]?.url).toBe('/api/v1/user')
        expect(received[0]?.headers).toMatchObject({
            authorization: 'Bearer tok-123',
            'user-agent': `todoist-mcp/${packageJson.version}`,
            'doist-platform': 'mcp',
            'doist-version': packageJson.version,
            'mcp-tool': 'auth:validate-token',
        })
    })

    it.each([
        [200, 'valid'],
        [401, 'invalid'],
        [403, 'forbidden'],
    ] as const)('returns the verdict for a %i: %s', async (code, expected) => {
        status = code
        await expect(validateTodoistToken('tok', baseUrl)).resolves.toBe(expected)
    })

    it('throws a TokenValidationError carrying the status on 5xx', async () => {
        status = 502
        const error = await validateTodoistToken('tok', baseUrl).catch((thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(TokenValidationError)
        expect(error).toMatchObject({ httpStatusCode: 502 })
    })

    it('lets a network failure through unchanged', async () => {
        const closed = createServer()
        await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
        const { port } = closed.address() as AddressInfo
        await new Promise<void>((resolve) => closed.close(() => resolve()))

        const error = await validateTodoistToken('tok', `http://127.0.0.1:${port}`).catch(
            (thrown: unknown) => thrown,
        )

        expect(error).not.toBeInstanceOf(TokenValidationError)
        expect(error).toMatchObject({ cause: { code: 'ECONNREFUSED' } })
    })
})

// Last in the file: swapping in a fake transport closes the SDK's real dispatcher, which the SDK
// keeps cached, so nothing after these may send a real request.
describe('validateTodoistToken transport', () => {
    beforeEach(async () => {
        await resetDefaultDispatcherForTests()
    })

    afterEach(async () => {
        await resetDefaultDispatcherForTests()
        resetDispatcherModuleLoaderForTests()
    })

    // The SDK's transport is what honours HTTP_PROXY, HTTPS_PROXY and NO_PROXY.
    it('sends through the SDK transport, with its dispatcher and paired fetch', async () => {
        const dispatcher = { kind: 'env-http-proxy-agent', close: vi.fn() }
        const calls: { url: string; init: RequestInit & { dispatcher?: unknown } }[] = []
        const pairedFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} })
            return new Response(null, { status: 403 })
        })
        setDispatcherModuleLoaderForTests(async () => ({
            getDefaultTransport: async () => ({
                dispatcher,
                fetch: pairedFetch as unknown as typeof fetch,
            }),
        }))

        await expect(validateTodoistToken('tok')).resolves.toBe('forbidden')

        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe('https://api.todoist.com/api/v1/user')
        expect(calls[0]?.init.dispatcher).toBe(dispatcher)
        expect(calls[0]?.init.redirect).toBe('manual')
    })

    it('resolves the user endpoint against the base URL the way the SDK does', async () => {
        const calls: string[] = []
        setDispatcherModuleLoaderForTests(async () => ({
            getDefaultTransport: async () => ({
                dispatcher: {},
                fetch: (async (url: RequestInfo | URL) => {
                    calls.push(String(url))
                    return new Response(null, { status: 200 })
                }) as typeof fetch,
            }),
        }))

        await validateTodoistToken('tok', 'https://custom.api.com/')
        await validateTodoistToken('tok', 'https://custom.api.com/some/path')

        expect(calls).toEqual([
            'https://custom.api.com/api/v1/user',
            'https://custom.api.com/api/v1/user',
        ])
    })

    // TODOIST_BASE_URL= reaches here as '', which the SDK client treats as unset.
    it('treats an empty base URL as unset', async () => {
        const calls: string[] = []
        setDispatcherModuleLoaderForTests(async () => ({
            getDefaultTransport: async () => ({
                dispatcher: {},
                fetch: (async (url: RequestInfo | URL) => {
                    calls.push(String(url))
                    return new Response(null, { status: 401 })
                }) as typeof fetch,
            }),
        }))

        await expect(validateTodoistToken('tok', '')).resolves.toBe('invalid')
        expect(calls).toEqual(['https://api.todoist.com/api/v1/user'])
    })
})
