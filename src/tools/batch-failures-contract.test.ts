import { describe, expect, it } from 'vitest'
import { registeredTools } from '../tool-registry.js'
import { ToolNames } from '../utils/tool-names.js'

/**
 * A batch write tool settles every item on its own and reports the ones it could
 * not act on in a `failures` array, even when every item fails. Throwing instead
 * hides the items that were written: the caller sees one error, assumes nothing
 * happened, and a retry of the whole batch writes them a second time.
 *
 * https://github.com/Doist/todoist-mcp/issues/505
 */
const ALL_OR_NOTHING_TOOLS: Partial<Record<string, string>> = {
    [ToolNames.RESCHEDULE_TASKS]:
        'one Sync request whose result is reported as a whole; retried as a whole',
    [ToolNames.MANAGE_ASSIGNMENTS]: 'rolls the batch back as a unit when it fails',
    [ToolNames.REORDER_OBJECTS]: 'one ordering of sibling items, applied as a unit',
}

type ZodDef = { type?: string; innerType?: unknown; in?: unknown }

function zodDef(schema: unknown): ZodDef | undefined {
    return (schema as { _zod?: { def?: ZodDef } } | undefined)?._zod?.def
}

/** Whether a parameter takes a list, looking through optional/default/pipe wrappers. */
function isArrayParameter(schema: unknown): boolean {
    let def = zodDef(schema)
    while (def && (def.type === 'optional' || def.type === 'default' || def.type === 'pipe')) {
        def = zodDef(def.innerType ?? def.in)
    }
    return def?.type === 'array'
}

const batchWriteTools = registeredTools.filter(
    (tool) =>
        !tool.annotations.readOnlyHint &&
        Object.values(tool.parameters).some((schema) => isArrayParameter(schema)),
)

describe('batch write tools', () => {
    it.each(
        batchWriteTools
            .filter((tool) => !(tool.name in ALL_OR_NOTHING_TOOLS))
            .map((tool) => [tool.name, tool] as const),
    )('%s reports per-item failures', (_name, tool) => {
        expect(Object.keys(tool.outputSchema ?? {})).toContain('failures')
    })

    it.each(Object.keys(ALL_OR_NOTHING_TOOLS))(
        '%s is still a registered batch write tool, or should leave the exemption list',
        (name) => {
            expect(batchWriteTools.map((tool) => tool.name)).toContain(name)
        },
    )
})
