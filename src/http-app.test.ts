import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHttpApp } from './http-app.js'
import { DEFAULT_ALLOWED_HOSTS } from './middleware/require-trusted-host.js'
import { clearTokenValidationCache } from './middleware/require-valid-todoist-token.js'

vi.mock('./utils/validate-todoist-token.js', () => ({
    validateTodoistToken: vi.fn(),
}))

import { validateTodoistToken } from './utils/validate-todoist-token.js'

const mockValidate = validateTodoistToken as Mock

type Server = ReturnType<typeof http.createServer>

let server: Server
let closeApp: () => Promise<void>

function startApp(): Promise<number> {
    const { app, close } = createHttpApp({
        todoistApiKey: 'test-key',
        allowedHosts: DEFAULT_ALLOWED_HOSTS,
    })
    closeApp = close
    return new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            resolve((server.address() as AddressInfo).port)
        })
    })
}

async function stopApp() {
    await closeApp?.()
    server?.close()
}

function request(
    port: number,
    options: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                method: options.method,
                path: options.path,
                headers: options.headers,
            },
            (res) => {
                let body = ''
                res.on('data', (chunk) => {
                    body += chunk
                })
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
            },
        )
        req.on('error', reject)
        if (options.body) {
            req.write(options.body)
        }
        req.end()
    })
}

const JSON_HEADERS = { 'content-type': 'application/json' }
const INIT_BODY = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

const PROTOCOL_2026 = '2026-07-28'
const PROTOCOL_2025 = '2025-11-25'

/** The per-request envelope a 2026-07-28 client puts in `params._meta`. */
const ENVELOPE_2026 = {
    'io.modelcontextprotocol/protocolVersion': PROTOCOL_2026,
    'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '0.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
}

function modernRequest(id: number, method: string, params: Record<string, unknown> = {}) {
    return {
        headers: {
            ...JSON_HEADERS,
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': PROTOCOL_2026,
            'mcp-method': method,
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params: { ...params, _meta: ENVELOPE_2026 },
        }),
    }
}

/** Read the first JSON-RPC result out of either a JSON body or an SSE stream. */
function firstJsonRpcResult(body: string): Record<string, unknown> {
    const messages: Array<{ result?: Record<string, unknown> }> =
        body.startsWith('event:') || body.startsWith('data:')
            ? body
                  .split('\n')
                  .filter((line) => line.startsWith('data: '))
                  .map((line) => JSON.parse(line.slice('data: '.length)))
            : [JSON.parse(body)]
    const result = messages[0]?.result
    if (!result) {
        throw new Error(`No JSON-RPC result in response: ${body.slice(0, 200)}`)
    }
    return result
}

describe('createHttpApp middleware chain', () => {
    beforeEach(() => {
        clearTokenValidationCache()
        mockValidate.mockReset()
        // Invalid token: a request that passes the Host/Origin guard reaches the
        // token middleware and gets a 401, which lets us prove the guard ran first
        // (a blocked request would be a 403 before token validation).
        mockValidate.mockResolvedValue(false)
    })

    afterEach(async () => {
        await stopApp()
    })

    it('rejects /mcp requests with an untrusted Host (DNS rebinding) with 403', async () => {
        const port = await startApp()
        const res = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: { ...JSON_HEADERS, host: 'evil.com' },
            body: INIT_BODY,
        })

        expect(res.status).toBe(403)
        expect(mockValidate).not.toHaveBeenCalled()
    })

    it('rejects /mcp requests with an untrusted Origin with 403', async () => {
        const port = await startApp()
        const res = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: { ...JSON_HEADERS, host: `127.0.0.1:${port}`, origin: 'http://evil.com' },
            body: INIT_BODY,
        })

        expect(res.status).toBe(403)
        expect(mockValidate).not.toHaveBeenCalled()
    })

    it('passes a trusted Host through the guard to token validation (401 on bad token)', async () => {
        const port = await startApp()
        const res = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: { ...JSON_HEADERS, host: `127.0.0.1:${port}` },
            body: INIT_BODY,
        })

        expect(res.status).toBe(401)
        expect(mockValidate).toHaveBeenCalledOnce()
    })

    it('exempts /health from the Host guard so deployment probes work', async () => {
        const port = await startApp()
        const res = await request(port, {
            method: 'GET',
            path: '/health',
            headers: { host: 'health-probe.internal' },
        })

        expect(res.status).toBe(200)
        expect(JSON.parse(res.body)).toEqual({ status: 'ok' })
    })

    it('returns 405 for GET /mcp from a trusted Host', async () => {
        const port = await startApp()
        const res = await request(port, {
            method: 'GET',
            path: '/mcp',
            headers: { host: `127.0.0.1:${port}` },
        })

        expect(res.status).toBe(405)
    })
})

describe('createHttpApp protocol revisions', () => {
    let port: number

    beforeEach(async () => {
        clearTokenValidationCache()
        mockValidate.mockReset()
        mockValidate.mockResolvedValue(true)
        port = await startApp()
    })

    afterEach(async () => {
        await stopApp()
    })

    it('answers server/discover for a 2026-07-28 client', async () => {
        const modern = modernRequest(1, 'server/discover')
        const res = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: { ...modern.headers, host: `127.0.0.1:${port}` },
            body: modern.body,
        })

        expect(res.status).toBe(200)
        const result = firstJsonRpcResult(res.body)
        expect(result.supportedVersions).toContain(PROTOCOL_2026)
        expect(result.resultType).toBe('complete')
        expect(result._meta).toMatchObject({
            'io.modelcontextprotocol/serverInfo': { name: 'todoist-mcp-server' },
        })
    })

    it('serves tools/list to a 2026-07-28 client with the cacheable-result fields', async () => {
        const modern = modernRequest(2, 'tools/list')
        const res = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: { ...modern.headers, host: `127.0.0.1:${port}` },
            body: modern.body,
        })

        expect(res.status).toBe(200)
        const result = firstJsonRpcResult(res.body)
        expect(Array.isArray(result.tools)).toBe(true)
        expect((result.tools as unknown[]).length).toBeGreaterThan(0)
        expect(result.resultType).toBe('complete')
        expect(typeof result.ttlMs).toBe('number')
        expect(['public', 'private']).toContain(result.cacheScope)
    })

    it('still serves a 2025-era client that opens with initialize', async () => {
        const res = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: {
                ...JSON_HEADERS,
                accept: 'application/json, text/event-stream',
                'mcp-protocol-version': PROTOCOL_2025,
                host: `127.0.0.1:${port}`,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 3,
                method: 'initialize',
                params: {
                    protocolVersion: PROTOCOL_2025,
                    capabilities: {},
                    clientInfo: { name: 'test-client', version: '0.0.0' },
                },
            }),
        })

        expect(res.status).toBe(200)
        const result = firstJsonRpcResult(res.body)
        expect(result.protocolVersion).toBe(PROTOCOL_2025)
        expect(result.serverInfo).toMatchObject({ name: 'todoist-mcp-server' })
    })

    it('serves tools/list to a 2025-era client without a session', async () => {
        const res = await request(port, {
            method: 'POST',
            path: '/mcp',
            headers: {
                ...JSON_HEADERS,
                accept: 'application/json, text/event-stream',
                'mcp-protocol-version': PROTOCOL_2025,
                host: `127.0.0.1:${port}`,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }),
        })

        expect(res.status).toBe(200)
        const result = firstJsonRpcResult(res.body)
        expect(Array.isArray(result.tools)).toBe(true)
        expect((result.tools as unknown[]).length).toBeGreaterThan(0)
        expect(result).not.toHaveProperty('resultType')
    })
})
