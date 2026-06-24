import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
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

/**
 * Build the Express app for the MCP HTTP server.
 *
 * The DNS-rebinding guard (`requireTrustedHost`) is scoped to the sensitive
 * `/mcp` routes and runs ahead of body parsing and token auth there. `/health`
 * is intentionally unguarded so deployment health probes — which send the
 * target's private IP in the Host header — keep working; it exposes no account
 * data.
 */
function createHttpApp({ todoistApiKey, baseUrl, allowedHosts }: CreateHttpAppOptions): Express {
    const app = express()
    const trustedHost = requireTrustedHost({ allowedHosts })

    // Health check endpoint (no host guard — see above).
    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok' })
    })

    // MCP endpoint - POST for requests.
    // `trustedHost` rejects untrusted Host/Origin with a cheap 403 before the
    // body is parsed. `requireValidTodoistToken` then validates the token so that
    // invalid tokens produce an HTTP 401 (per MCP spec) instead of being
    // swallowed into a 200 JSON-RPC response with isError: true.
    app.post(
        '/mcp',
        trustedHost,
        express.json(),
        requireValidTodoistToken({ type: 'static', apiKey: todoistApiKey, baseUrl }),
        async (req: Request, res: Response) => {
            try {
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined,
                })

                const server = getMcpServer({ todoistApiKey, baseUrl })
                await server.connect(transport)
                await transport.handleRequest(req, res, req.body)
            } catch (error) {
                console.error('[Error] Request handling failed:', error)
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                })
            }
        },
    )

    // MCP endpoint - GET returns 405 (needed for MCP client compatibility).
    app.get('/mcp', trustedHost, (_req: Request, res: Response) => {
        res.status(405).set('Allow', 'POST').send('Method Not Allowed')
    })

    return app
}

export { createHttpApp, type CreateHttpAppOptions }
