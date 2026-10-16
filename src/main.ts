#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import dotenv from 'dotenv'
import { getMcpServer } from './mcp-server.js'

function main() {
    const baseUrl = process.env.TODOIST_BASE_URL
    const todoistApiKey = process.env.TODOIST_API_KEY
    if (!todoistApiKey) {
        throw new Error('TODOIST_API_KEY is not set')
    }

    // `serveStdio` owns the protocol-revision decision for the connection: a
    // client that opens with the per-request `_meta` envelope (revision
    // 2026-07-28 and later) and one that opens with `initialize` are both served
    // from the same factory, so the tools are defined once.
    serveStdio(() => getMcpServer({ todoistApiKey, baseUrl }), {
        onerror: (error) => {
            // We use console.error because standard I/O is being used for the MCP server communication.
            console.error('Todoist MCP server error:', error)
        },
    })
    console.error('Server started')
}

dotenv.config({ quiet: true })
main()
