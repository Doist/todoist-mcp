/**
 * Normalizes a filter's description for structured output.
 *
 * A filter with no description can arrive as either `null` or `""`: the column is
 * nullable, and the sync view normalizes NULL to an empty string on the way out.
 * Both mean the same thing, so both collapse to `undefined` here.
 *
 * Returning `undefined` rather than `null` matters. Structured content is sanitised
 * with `removeNullFields` on the way out, so a null would be stripped from the payload
 * and then fail validation against the declared output schema, which is optional
 * rather than nullable.
 */
export function readFilterDescription(filter: { description?: string | null }): string | undefined {
    // `||` not `??`: an empty string has to collapse too, not just null.
    return filter.description || undefined
}
