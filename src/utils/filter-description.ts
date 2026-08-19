/**
 * Reads a filter's description off a sync payload.
 *
 * `FilterSchema` in the published SDK is a loose object that does not declare
 * `description`, so the field arrives typed as `unknown`. This narrows it in one
 * place instead of casting at each call site.
 *
 * Returns `undefined` rather than `null` for a filter with no description, so
 * the key can be left out of `structuredContent` entirely. Structured content is
 * sanitised with `removeNullFields` on the way out, so a null would be stripped
 * and fail validation against the declared output schema.
 *
 * The backend sends `""` for a filter with no description: the column is
 * nullable but the sync view normalizes NULL on the way out. Both are treated as
 * absent here.
 *
 * Delete this once `@doist/todoist-sdk` carries `description` on its filter
 * types, and read `filter.description` directly.
 */
export function readFilterDescription(filter: Record<string, unknown>): string | undefined {
    const description = filter.description
    return typeof description === 'string' && description.length > 0 ? description : undefined
}
