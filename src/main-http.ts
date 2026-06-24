#!/usr/bin/env node
import { isIP } from 'node:net'
/**
 * HTTP Server for Todoist MCP in stateless mode.
 *
 * This server provides an alternative to the hosted service at ai.todoist.net/mcp.
 * Each request creates a fresh transport and MCP server instance — no session
 * tracking, timeouts, or cleanup required.
 *
 * Environment variables:
 * - TODOIST_API_KEY: Required. Your Todoist API key.
 * - TODOIST_BASE_URL: Optional. Custom Todoist API base URL.
 * - PORT: Optional. Server port (default: 3000).
 * - HOST: Optional. Bind host (default: 127.0.0.1). Use non-loopback hosts
 *   only behind trusted network/auth controls because requests run with
 *   TODOIST_API_KEY.
 *
 * @see https://github.com/Doist/todoist-mcp/issues/239
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import dotenv from 'dotenv'
import express, { type Request, type Response } from 'express'
import { getMcpServer } from './mcp-server.js'
import { requireValidTodoistToken } from './middleware/require-valid-todoist-token.js'

dotenv.config({ quiet: true })

const PORT = Number.parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '127.0.0.1'
const LISTEN_HOST = normalizeListenHost(HOST)

function normalizeListenHost(host: string): string {
    if (host.startsWith('[') && host.endsWith(']')) {
        return host.slice(1, -1)
    }
    return host
}

function formatUrlHost(host: string): string {
    if (host === '0.0.0.0' || host === '::') {
        return 'localhost'
    }
    return formatListenHost(host)
}

function formatListenHost(host: string): string {
    if (isIP(host) === 6) {
        return `[${host}]`
    }
    return host
}

function isLoopbackHost(host: string): boolean {
    host = normalizeListenHost(host)
    if (host === 'localhost') {
        return true
    }
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
        return true
    }
    if (isIP(host) === 4) {
        return host.split('.')[0] === '127'
    }
    return false
}

function main() {
    const baseUrl = process.env.TODOIST_BASE_URL
    const todoistApiKey = process.env.TODOIST_API_KEY

    if (!todoistApiKey) {
        console.error('Error: TODOIST_API_KEY environment variable is required')
        process.exit(1)
    }

    const app = express()
    app.use(express.json())

    // Health check endpoint
    app.get('/health', (_req: Request, res: Response) => {
        res.json({ status: 'ok' })
    })

    // MCP endpoint - POST for requests
    // Validate the Todoist API token before MCP processing so that invalid
    // tokens produce an HTTP 401 (per MCP spec) instead of being swallowed
    // into a 200 JSON-RPC response with isError: true.
    app.post(
        '/mcp',
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

    // MCP endpoint - GET returns 405 (needed for MCP client compatibility)
    app.get('/mcp', (_req: Request, res: Response) => {
        res.status(405).set('Allow', 'POST').send('Method Not Allowed')
    })

    app.listen(PORT, LISTEN_HOST, () => {
        const displayHost = formatUrlHost(LISTEN_HOST)
        console.error(`Todoist MCP HTTP Server started on ${formatListenHost(LISTEN_HOST)}:${PORT}`)
        console.error(`MCP endpoint: http://${displayHost}:${PORT}/mcp`)
        console.error(`Health check: http://${displayHost}:${PORT}/health`)
        if (!isLoopbackHost(LISTEN_HOST)) {
            console.error(
                'Warning: todoist-mcp-http is reachable from other hosts. ' +
                    'Protect this service with trusted network/auth controls because requests run with TODOIST_API_KEY.',
            )
        }
    })
}

main()
