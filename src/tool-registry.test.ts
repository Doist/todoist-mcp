import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { registeredTools, toolRegistry } from './tool-registry.js'
import { ToolNames } from './utils/tool-names.js'

/**
 * `registeredTools` is the single source of truth for the tool surface, but a
 * couple of places still keep their own view of it. These tests fail when those
 * views drift, which is how six tools once went missing from the public `tools`
 * export — silently reducing `npm run lint:schemas` coverage — while four others
 * became uninvokable through `scripts/run-tool.ts`.
 *
 * `mcp-server.ts` needs no assertion here: it registers by iterating this array,
 * so it cannot disagree with it. That every registered tool is also annotated is
 * covered by `tools/tool-annotations.test.ts`.
 */
describe('tool registry', () => {
    const registryNames = registeredTools.map((tool) => tool.name).sort()

    it('has no duplicate entries', () => {
        expect(registryNames).toEqual([...new Set(registryNames)])
    })

    it('matches the ToolNames enum', () => {
        expect(registryNames).toEqual(Object.values(ToolNames).sort())
    })

    it('is what the public tools export is built from', async () => {
        const { tools } = await import('./index.js')
        expect(tools).toBe(toolRegistry)
    })

    it('has a named package export for every tool', async () => {
        // `tools` is derived, but the named re-exports that let consumers write
        // `import { addTasks } from '@doist/todoist-mcp'` are still written out
        // by hand, so they can fall behind the registry.
        const packageExports = await import('./index.js')
        const missing = Object.keys(toolRegistry).filter((key) => !(key in packageExports))
        expect(missing).toEqual([])
    })

    it('is what scripts/run-tool.ts builds its lookup from', () => {
        // run-tool.ts calls main() at module scope, so it cannot be imported
        // here. It derives its lookup by iterating the registry and so cannot
        // hold a divergent list; this only checks that wiring is still in place.
        const source = readFileSync(join(import.meta.dirname, '../scripts/run-tool.ts'), 'utf8')
        expect(source).toContain("from '../src/tool-registry.js'")
    })
})
