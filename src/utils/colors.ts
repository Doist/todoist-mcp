import type { ColorKey } from '@doist/todoist-sdk'
import { colors } from '@doist/todoist-sdk'
import { z } from 'zod'

const colorKeys = colors.map((c) => c.key) as [ColorKey, ...ColorKey[]]

function normalizeColor(val: unknown): string | undefined {
    if (typeof val !== 'string') return undefined
    const lower = val.toLowerCase()
    const found =
        colors.find((c) => c.key === lower) ??
        colors.find((c) => c.displayName.toLowerCase() === lower)
    return found?.key // undefined if not recognized
}

const colorDescription =
    'Color for the entity. Accepts a color key (e.g. "berry_red") or display name (e.g. "Berry Red"). ' +
    `Valid colors: ${colorKeys.join(', ')}. ` +
    'Unrecognized colors are omitted and charcoal will be used as the default.'

// For INPUT: normalizes key or display name → canonical key (or undefined if unrecognized)
export const ColorSchema = z
    .preprocess(normalizeColor, z.enum(colorKeys).optional())
    .describe(colorDescription)

// For OUTPUT: strict enum. Kept for reference — output schemas use ColorOutputSchema.
export const ColorKeySchema = z.enum(colorKeys)

// For OUTPUT (tolerant): accepts valid color keys and silently coerces unrecognised values
// to undefined instead of raising a validation error.  Fixes both failure modes described in issue #343:
//   1. Full list — loud MCP output-validation error (-32602)
//   2. Name search — silent empty result set due to swallowed validation error
// This is the output-side counterpart to ColorSchema, which uses .preprocess()/.catch() for
// input normalisation (added in PR #328).
export const ColorOutputSchema = z.enum(colorKeys).optional().catch(undefined)
