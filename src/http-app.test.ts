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

function startApp(): Promise<number> {
    const app = createHttpApp({ todoistApiKey: 'test-key', allowedHosts: DEFAULT_ALLOWED_HOSTS })
    return new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            resolve((server.address() as AddressInfo).port)
        })
    })
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

describe('createHttpApp middleware chain', () => {
    beforeEach(() => {
        clearTokenValidationCache()
        mockValidate.mockReset()
        // Invalid token: a request that passes the Host/Origin guard reaches the
        // token middleware and gets a 401, which lets us prove the guard ran first
        // (a blocked request would be a 403 before token validation).
        mockValidate.mockResolvedValue(false)
    })

    afterEach(() => {
        server?.close()
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
