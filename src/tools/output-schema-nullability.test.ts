import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { registeredTools } from '../tool-registry.js'

/**
 * Structured content is sanitised with `removeNullFields` on its way out, so no
 * null ever reaches a client. A tool that declares an output field as nullable
 * therefore promises a value it can never send: the MCP SDK validates the
 * sanitised payload against the declared output schema and fails the whole call
 * with "Output validation error" as soon as that field is stripped.
 *
 * The shape that survives sanitisation is `.optional()` with the key left out of
 * `structuredContent` when there is nothing to report.
 */
function findNullablePaths(node: unknown, path: string): string[] {
    if (!node || typeof node !== 'object') {
        return []
    }

    if (Array.isArray(node)) {
        return node.flatMap((item) => findNullablePaths(item, path))
    }

    const schema = node as Record<string, unknown>
    const { type } = schema

    if (type === 'null' || (Array.isArray(type) && type.includes('null'))) {
        return [path]
    }

    const paths: string[] = []

    const properties = schema.properties
    if (properties && typeof properties === 'object') {
        for (const [key, value] of Object.entries(properties)) {
            paths.push(...findNullablePaths(value, path ? `${path}.${key}` : key))
        }
    }

    for (const key of ['items', 'additionalProperties', 'not']) {
        paths.push(...findNullablePaths(schema[key], key === 'items' ? `${path}[]` : path))
    }

    for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
        paths.push(...findNullablePaths(schema[key], path))
    }

    const defs = schema.$defs
    if (defs && typeof defs === 'object') {
        for (const [key, value] of Object.entries(defs)) {
            paths.push(...findNullablePaths(value, `$defs.${key}`))
        }
    }

    return paths
}

describe('tool output schemas', () => {
    it.each(registeredTools.map((tool) => [tool.name, tool] as const))(
        '%s declares no nullable output fields',
        (_name, tool) => {
            const jsonSchema = z.toJSONSchema(z.object(tool.outputSchema))

            // Nullable output fields cannot survive `removeNullFields`; use
            // `.optional()` and omit the key instead.
            expect(findNullablePaths(jsonSchema, '')).toEqual([])
        },
    )
})
