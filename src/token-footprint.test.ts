import { describeTokenFootprint } from '@todoist/mcp-core/testing'
import { encode } from 'gpt-tokenizer'
import { getMcpServer } from './mcp-server.js'

// Budget for the combined fixed token cost (tools/list payload + instructions), measured as a
// client receives them. Treat it as a ratchet rather than headroom: it should move down over
// time, and a rise needs justifying in the PR that causes it. Override at runtime with
// MCP_TOKEN_BUDGET=NNNN to experiment without editing the source.
const DEFAULT_TOKEN_BUDGET = 36_200

describeTokenFootprint({
    createServer: () => getMcpServer({ token: 'test-token' }),
    countTokens: (text) => encode(text).length,
    budget: Number(process.env.MCP_TOKEN_BUDGET ?? DEFAULT_TOKEN_BUDGET),
})
