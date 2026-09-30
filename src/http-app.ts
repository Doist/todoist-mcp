import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import express, { type Express, type Request, type Response } from 'express'
import { getMcpServer } from './mcp-server.js'
import { requireTrustedHost } from './middleware/require-trusted-host.js'
import { requireValidTodoistToken } from './middleware/require-valid-todoist-token.js'

type CreateHttpAppOptions = {
    todoistApiKey: string
    baseUrl?: string
    /** Hostnames trusted in the Host/Origin headers (DNS-rebinding protection). */
    allowedHosts: string[]
}

type HttpApp = {
    app: Express
    /**
     * Ends the open `subscriptions/listen` streams and aborts in-flight MCP
     * exchanges. Call it before closing the HTTP server, otherwise
     * `server.close()` waits for those streams to end on their own.
     */
    close: () => Promise<void>
}

/**
 * Build the Express app for the MCP HTTP server.
 *
 * The DNS-rebinding guard (`requireTrustedHost`) is scoped to the sensitive
 * `/mcp` routes and runs ahead of body parsing and token auth there. `/health`
 * is intentionally unguarded so deployment health probes — which send the
 * target's private IP in the Host header — keep working; it exposes no account
 * data.
 */
function createHttpApp({ todoistApiKey, baseUrl, allowedHosts }: CreateHttpAppOptions): HttpApp {
    const app = express()
    const trustedHost = requireTrustedHost({ allowedHosts })

    // Health check endpoint (no host guard — see above).
    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok' })
    })

    // One handler serves every protocol revision from the same server factory.
    // Requests carrying the per-request `_meta` envelope (protocol revision
    // 2026-07-28 and later) are answered directly; earlier revisions that still
    // open with `initialize` fall back to stateless serving of that single
    // request. Either way a fresh McpServer is built per request and nothing is
    // kept between requests, so any instance behind a load balancer can answer.
    const mcpHandler = createMcpHandler(() => getMcpServer({ todoistApiKey, baseUrl }), {
        onerror: (error) => {
            console.error('[Error] MCP request rejected:', error)
        },
    })
    const handleMcpRequest = toNodeHandler(mcpHandler, {
        onerror: (error) => {
            console.error('[Error] Request handling failed:', error)
        },
    })

    // MCP endpoint - POST for requests.
    // `trustedHost` rejects untrusted Host/Origin with a cheap 403 before the
    // body is parsed. `requireValidTodoistToken` then validates the token so that
    // invalid tokens produce an HTTP 401 (per MCP spec) instead of being
    // swallowed into a 200 JSON-RPC response with isError: true.
    //
    // `express.json()` has already drained the request stream, so the parsed
    // body must be handed to the handler explicitly. Passing `handleMcpRequest`
    // straight to Express would put `next` in that position, which the handler
    // ignores, and it would then find an empty stream.
    app.post(
        '/mcp',
        trustedHost,
        express.json(),
        requireValidTodoistToken({ type: 'static', apiKey: todoistApiKey, baseUrl }),
        (req: Request, res: Response) => handleMcpRequest(req, res, req.body),
    )

    // MCP endpoint - GET returns 405. Server-to-client notifications are opted
    // into over a `subscriptions/listen` POST, and there is no session to resume,
    // so nothing is served on GET. Older clients that probe GET expect the 405.
    app.get('/mcp', trustedHost, (_req: Request, res: Response) => {
        res.status(405).set('Allow', 'POST').send('Method Not Allowed')
    })

    return { app, close: mcpHandler.close }
}

export { createHttpApp, type CreateHttpAppOptions, type HttpApp }
