/**
 * Reads a filter's description off a sync payload.
 *
 * `FilterSchema` in the published SDK is a loose object that does not declare
 * `description`, so the field arrives typed as `unknown`. This narrows it in one
 * place instead of casting at each call site.
 *
 * Delete this once `@doist/todoist-sdk` carries `description` on its filter
 * types, and read `filter.description` directly.
 */
export function readFilterDescription(filter: Record<string, unknown>): string | null {
    const description = filter.description
    return typeof description === 'string' ? description : null
}
