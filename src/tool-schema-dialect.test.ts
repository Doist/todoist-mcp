import { describeAdvertisedToolSchemas } from '@doist/mcp-core/testing'
import { getMcpServer } from './mcp-server.js'
import { registeredTools } from './tool-registry.js'

// Every registered tool is advertised once, with JSON Schema 2020-12 schemas that match a direct
// Zod conversion of its own shapes.
describeAdvertisedToolSchemas({
    tools: registeredTools,
    createServer: () => getMcpServer({ todoistApiKey: 'test-token' }),
})
