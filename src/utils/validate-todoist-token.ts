import { type ValidateToken, validateBearerToken } from '@todoist/mcp-core/host'

import { buildUsageTrackingHeaders, fetchThroughSdkTransport } from '../usage-tracking.js'

/** The Todoist SDK's default API base. */
const DEFAULT_BASE_URL = 'https://api.todoist.com'

/**
 * Validates a Todoist API token with a status-only call to the user endpoint.
 *
 * Resolves `'valid'`, `'invalid'` (401) or `'forbidden'` (403), so a host can answer a token that
 * lacks a scope with an RFC 6750 `insufficient_scope` challenge rather than a blanket 401. The
 * body is never parsed, so a change to the user object can't turn a valid token into an error.
 *
 * The request goes out through the SDK's transport, so it honours the same proxy settings as
 * every tool call, and carries the usage-tracking headers as `auth:validate-token`.
 *
 * @throws {TokenValidationError} (from `@todoist/mcp-core/host`) for any other status, such as a
 * 5xx, carrying it as `httpStatusCode`. Network and timeout errors propagate unchanged.
 */
const validateTodoistToken: ValidateToken = (token, baseUrl) =>
    validateBearerToken({
        // Resolved the way the SDK resolves its own requests against a custom base URL. An empty
        // base (`TODOIST_BASE_URL=`) means the default, as it does for the SDK client.
        url: new URL('/api/v1/user', baseUrl || DEFAULT_BASE_URL),
        token,
        headers: buildUsageTrackingHeaders({ label: 'auth:validate-token' }),
        fetch: fetchThroughSdkTransport,
    })

export { validateTodoistToken }
