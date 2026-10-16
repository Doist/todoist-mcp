#!/usr/bin/env node
import { isIP } from 'node:net'
/**
 * HTTP Server entrypoint for Todoist MCP in stateless mode.
 *
 * Thin bootstrap: reads configuration from the environment, builds the Express
 * app via createHttpApp(), and starts listening. The app itself (and its
 * middleware chain) lives in ./http-app.ts so it can be tested without starting
 * a server. Each request is answered by a fresh MCP server instance — no
 * session tracking, timeouts, or cleanup required. Clients on protocol revision
 * 2026-07-28 or later are served directly; older clients that open with
 * `initialize` get stateless serving of that single request.
 *
 * Environment variables:
 * - TODOIST_API_KEY: Required. Your Todoist API key.
 * - TODOIST_BASE_URL: Optional. Custom Todoist API base URL.
 * - PORT: Optional. Server port (default: 3000).
 * - HOST: Optional. Bind host (default: 127.0.0.1). Use non-loopback hosts
 *   only behind trusted network/auth controls because requests run with
 *   TODOIST_API_KEY.
 * - ALLOWED_HOSTS: Optional. Comma-separated hostnames (in addition to the
 *   loopback defaults) trusted in the Host and Origin headers for DNS-rebinding
 *   protection. Required when binding to 0.0.0.0 so LAN clients' hostnames are
 *   accepted. IPv6 entries must be bracketed, e.g. [2001:db8::1].
 *
 * The /mcp endpoint validates the Host and Origin headers against this allowlist
 * before any request handling (DNS-rebinding protection). /health is exempt so
 * deployment health probes (which use the target's private IP in the Host
 * header) keep working.
 *
 * @see https://github.com/Doist/todoist-mcp/issues/239
 */
import dotenv from 'dotenv'
import { createHttpApp } from './http-app.js'
import { buildAllowedHosts } from './middleware/require-trusted-host.js'
import { isLoopbackHost, normalizeListenHost } from './utils/host.js'

dotenv.config({ quiet: true })

const PORT = Number.parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '127.0.0.1'
const LISTEN_HOST = normalizeListenHost(HOST)

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

function main() {
    const baseUrl = process.env.TODOIST_BASE_URL
    const todoistApiKey = process.env.TODOIST_API_KEY

    if (!todoistApiKey) {
        console.error('Error: TODOIST_API_KEY environment variable is required')
        process.exit(1)
    }

    const allowedHosts = buildAllowedHosts(HOST, process.env.ALLOWED_HOSTS)
    const { app, close } = createHttpApp({ todoistApiKey, baseUrl, allowedHosts })

    const server = app.listen(PORT, LISTEN_HOST, () => {
        const displayHost = formatUrlHost(LISTEN_HOST)
        console.error(`Todoist MCP HTTP Server started on ${formatListenHost(LISTEN_HOST)}:${PORT}`)
        console.error(`MCP endpoint: http://${displayHost}:${PORT}/mcp`)
        console.error(`Health check: http://${displayHost}:${PORT}/health`)
        if (!isLoopbackHost(LISTEN_HOST)) {
            console.error(
                'Warning: todoist-mcp-http is reachable from other hosts. ' +
                    'Set ALLOWED_HOSTS to the hostnames clients use and protect this service with ' +
                    'trusted network/auth controls because requests run with TODOIST_API_KEY.',
            )
        }
    })

    // Graceful shutdown: end the MCP handler's open notification streams first,
    // otherwise `server.close()` waits for them to end on their own. Idle
    // keep-alive sockets, which MCP clients commonly hold open, would also keep
    // `server.close()` waiting, so they are closed explicitly.
    let shuttingDown = false
    const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) {
            return
        }
        shuttingDown = true
        console.error(`Received ${signal}, shutting down`)
        close()
            .catch((error) => {
                console.error('Error closing MCP handler:', error)
            })
            .finally(() => {
                server.close(() => process.exit(0))
                server.closeIdleConnections()
            })
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
}

main()
