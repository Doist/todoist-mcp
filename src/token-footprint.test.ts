import { encode } from 'gpt-tokenizer'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { instructions } from './mcp-server.js'
import type { AnyTodoistTool } from './todoist-tool.js'
import { registeredTools } from './tool-registry.js'

// SDK v2 serializes Standard Schemas as JSON Schema 2020-12. Zod defaults `io`
// to 'output', which measures a schema the wire never carries — for tools using
// `.pipe()` that can be several times the real cost. Keep these in step with the SDK.
const INPUT_SCHEMA_OPTIONS = { io: 'input', target: 'draft-2020-12' } as const
const OUTPUT_SCHEMA_OPTIONS = { io: 'output', target: 'draft-2020-12' } as const

function tokens(text: string): number {
    return encode(text).length
}

function formatToolTitle(name: string): string {
    return name
        .split('-')
        .filter(Boolean)
        .map((s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`)
        .join(' ')
}

/**
 * Mirror of the `_meta` normalisation in `registerTool`, which fills in whichever
 * of the two widget resource-URI spellings the tool did not declare.
 */
function normalizeAppUiMeta(meta: Record<string, unknown>): Record<string, unknown> {
    const ui = meta.ui as { resourceUri?: string } | undefined
    const legacyUri = meta['ui/resourceUri']

    if (ui?.resourceUri && !legacyUri) {
        return { ...meta, 'ui/resourceUri': ui.resourceUri }
    }
    if (typeof legacyUri === 'string' && !ui?.resourceUri) {
        return { ...meta, ui: { ...ui, resourceUri: legacyUri } }
    }
    return meta
}

function buildToolListEntry(tool: AnyTodoistTool) {
    const entry: Record<string, unknown> = {
        name: tool.name,
        title: `Todoist: ${formatToolTitle(tool.name)}`,
        description: tool.description,
        inputSchema: z.toJSONSchema(z.object(tool.parameters), INPUT_SCHEMA_OPTIONS),
        annotations: {
            title: `Todoist: ${formatToolTitle(tool.name)}`,
            openWorldHint: false,
            ...tool.annotations,
        },
    }
    if (tool.outputSchema) {
        entry.outputSchema = z.toJSONSchema(z.object(tool.outputSchema), OUTPUT_SCHEMA_OPTIONS)
    }
    if (tool._meta) {
        // The SDK forwards `_meta` on every tools/list entry, so it is part of
        // the fixed cost. Registration normalises the widget resource URI into
        // both the `ui.resourceUri` and `ui/resourceUri` spellings; mirror that
        // or the measurement undercounts the tools that carry one.
        entry._meta = normalizeAppUiMeta(tool._meta)
    }
    return entry
}

type Row = {
    name: string
    descriptionTokens: number
    inputSchemaTokens: number
    outputSchemaTokens: number
    totalTokens: number
}

function measure(): Row[] {
    return registeredTools.map((tool) => {
        const entry = buildToolListEntry(tool)
        const inputSchemaJson = JSON.stringify(entry.inputSchema)
        const outputSchemaJson = entry.outputSchema ? JSON.stringify(entry.outputSchema) : ''
        const fullEntryJson = JSON.stringify(entry)
        return {
            name: tool.name,
            descriptionTokens: tokens(tool.description),
            inputSchemaTokens: tokens(inputSchemaJson),
            outputSchemaTokens: outputSchemaJson ? tokens(outputSchemaJson) : 0,
            totalTokens: tokens(fullEntryJson),
        }
    })
}

// Budget for the combined fixed token cost (tools/list payload + instructions).
// Treat it as a ratchet rather than headroom: it should move down over time, and
// a rise needs justifying in the PR that causes it. Override at runtime with
// MCP_TOKEN_BUDGET=NNNN to experiment without editing the source.
const DEFAULT_TOKEN_BUDGET = 35_000
const TOKEN_BUDGET = Number(process.env.MCP_TOKEN_BUDGET ?? DEFAULT_TOKEN_BUDGET)

describe('token footprint baseline', () => {
    it('reports per-tool and total token cost', () => {
        const rows = measure().sort((a, b) => b.totalTokens - a.totalTokens)
        const toolsListTotal = rows.reduce((acc, r) => acc + r.totalTokens, 0)
        const instructionsTokens = tokens(instructions)
        const combinedFixed = toolsListTotal + instructionsTokens

        const pad = (s: string | number, n: number) => String(s).padStart(n)
        const lines: string[] = []
        lines.push('')
        lines.push('=== MCP token footprint baseline ===')
        lines.push(`tools registered:    ${registeredTools.length}`)
        lines.push(`instructions string: ${instructionsTokens} tokens`)
        lines.push(`tools/list payload:  ${toolsListTotal} tokens`)
        lines.push(`combined fixed cost: ${combinedFixed} tokens`)
        lines.push(`budget:              ${TOKEN_BUDGET} tokens`)
        lines.push('')
        lines.push('Per-tool ranking (total / desc / inputSchema / outputSchema):')
        for (const r of rows) {
            lines.push(
                `  ${pad(r.totalTokens, 5)}  ${pad(r.descriptionTokens, 4)}  ${pad(
                    r.inputSchemaTokens,
                    5,
                )}  ${pad(r.outputSchemaTokens, 5)}   ${r.name}`,
            )
        }
        // biome-ignore lint/suspicious/noConsole: intentional baseline output
        console.log(lines.join('\n'))

        // Soft budget cap: fails only on catastrophic growth, not normal drift.
        // Per-tool numbers above are the informative signal for reviewers.
        expect(combinedFixed).toBeLessThan(TOKEN_BUDGET)
    })
})
