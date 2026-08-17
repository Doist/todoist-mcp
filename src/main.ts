#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import dotenv from 'dotenv'
import { getMcpServer } from './mcp-server.js'

function main() {
    const baseUrl = process.env.TODOIST_BASE_URL
    const todoistApiKey = process.env.TODOIST_API_KEY
    if (!todoistApiKey) {
        throw new Error('TODOIST_API_KEY is not set')
    }

    const server = getMcpServer({ todoistApiKey, baseUrl })
    const transport = new StdioServerTransport()
    server
        .connect(transport)
        .then(() => {
            // We use console.error because standard I/O is being used for the MCP server communication.
            console.error('Server started')
        })
        .catch((error) => {
            console.error('Error starting the Todoist MCP server:', error)
            process.exit(1)
        })
}

dotenv.config({ quiet: true })
main()
