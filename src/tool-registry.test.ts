import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { tools } from './index.js'
import { registeredTools } from './tool-registry.js'
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

    it('matches the public tools export', () => {
        const exported = Object.values(tools)
            .map((tool) => tool.name)
            .sort()
        expect(exported).toEqual(registryNames)
    })

    it('is fully reachable through scripts/run-tool.ts', () => {
        // The script builds its lookup from the registry, so this guards the
        // wiring rather than a second list.
        const source = readFileSync(join(import.meta.dirname, '../scripts/run-tool.ts'), 'utf8')
        expect(source).toContain("import { registeredTools } from '../src/tool-registry.js'")
        expect(source).toMatch(/registeredTools\.map\(\(tool\) => \[tool\.name, /)
    })
})
