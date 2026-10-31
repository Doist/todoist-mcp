import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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
const EXCEPTIONS: Partial<Record<string, string>> = {
    [ToolNames.MANAGE_ASSIGNMENTS]:
        "reports each task's outcome in its own results and throws only when every task failed, so no write is hidden",
    [ToolNames.RESCHEDULE_TASKS]:
        'not converted yet: it sends one Sync request and throws on the first failed command, hiding the ones that were applied',
}

type JsonSchemaObject = { properties?: Record<string, { type?: unknown }> }

/** Reads a tool's schema the way it is advertised in `tools/list`. */
function jsonSchemaOf(shape: z.ZodRawShape, io: 'input' | 'output'): JsonSchemaObject {
    return z.toJSONSchema(z.object(shape), { io, target: 'draft-2020-12' }) as JsonSchemaObject
}

const batchWriteTools = registeredTools.filter(
    (tool) =>
        !tool.annotations.readOnlyHint &&
        Object.values(jsonSchemaOf(tool.parameters, 'input').properties ?? {}).some(
            (property) => property.type === 'array',
        ),
)

describe('batch write tools', () => {
    it('are found at all, so the checks below cannot pass vacuously', () => {
        expect(batchWriteTools.map((tool) => tool.name)).toEqual(
            expect.arrayContaining([ToolNames.ADD_TASKS, ToolNames.ADD_PROJECTS]),
        )
    })

    it.each(
        batchWriteTools
            .filter((tool) => !(tool.name in EXCEPTIONS))
            .map((tool) => [tool.name, tool] as const),
    )('%s reports per-item failures', (_name, tool) => {
        const failures = jsonSchemaOf(tool.outputSchema ?? {}, 'output').properties?.failures
        expect(failures?.type).toBe('array')
    })

    it.each(Object.keys(EXCEPTIONS))(
        '%s is still a registered batch write tool, or should leave the exceptions list',
        (name) => {
            expect(batchWriteTools.map((tool) => tool.name)).toContain(name)
        },
    )
})
