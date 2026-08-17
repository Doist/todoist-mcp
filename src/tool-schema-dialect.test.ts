import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { getMcpServer } from './mcp-server.js'
import { registeredTools } from './tool-registry.js'

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

describe('advertised tool schema dialects', () => {
    it('uses JSON Schema 2020-12 for every tool schema', async () => {
        const server = getMcpServer({ todoistApiKey: 'test-token' })
        const client = new Client({ name: 'schema-dialect-test', version: '1.0.0' })
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

        try {
            const { tools } = await client.listTools()

            expect(tools).toHaveLength(registeredTools.length)
            for (const tool of tools) {
                expect(tool.inputSchema.$schema).toBe(JSON_SCHEMA_2020_12)
                if (tool.outputSchema) {
                    expect(tool.outputSchema.$schema).toBe(JSON_SCHEMA_2020_12)
                }
            }
        } finally {
            await client.close()
            await server.close()
        }
    })
})
