import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { getMcpServer } from './mcp-server.js'
import { registeredTools } from './tool-registry.js'

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

async function listAdvertisedTools() {
    const server = getMcpServer({ todoistApiKey: 'test-token' })
    const client = new Client({ name: 'schema-dialect-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
        return (await client.listTools()).tools
    } finally {
        await client.close()
        await server.close()
    }
}

describe('advertised tool schema dialects', () => {
    it('uses JSON Schema 2020-12 for every tool schema', async () => {
        const tools = await listAdvertisedTools()

        expect(tools).toHaveLength(registeredTools.length)
        for (const tool of tools) {
            expect(tool.inputSchema.$schema).toBe(JSON_SCHEMA_2020_12)
            if (tool.outputSchema) {
                expect(tool.outputSchema.$schema).toBe(JSON_SCHEMA_2020_12)
            }
        }
    })

    it('matches direct Zod conversion for every registered tool', async () => {
        const toolsByName = new Map((await listAdvertisedTools()).map((tool) => [tool.name, tool]))

        for (const tool of registeredTools) {
            const advertised = toolsByName.get(tool.name)
            expect(advertised, `missing advertised tool ${tool.name}`).toBeDefined()
            expect(advertised?.inputSchema).toEqual(
                z.toJSONSchema(z.object(tool.parameters), {
                    target: 'draft-2020-12',
                    io: 'input',
                }),
            )

            if (tool.outputSchema) {
                expect(advertised?.outputSchema).toEqual(
                    z.toJSONSchema(z.object(tool.outputSchema), {
                        target: 'draft-2020-12',
                        io: 'output',
                    }),
                )
            } else {
                expect(advertised?.outputSchema).toBeUndefined()
            }
        }
    })
})
