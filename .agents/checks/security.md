# Check: security

The server holds a user's Todoist token and runs tools a model chooses. Apply to changes in `src/`.

## Report

- A token, `Authorization` header or `.env` value written to logs, errors, `textContent` or `structuredContent`.
- Changes to `src/middleware/` (`require-trusted-host.ts`, `require-valid-todoist-token.ts`) or `src/http-app.ts` that widen who can call `/mcp`: new allowed hosts, a skipped check, a route outside the guard.
- A URL built from model input and fetched by the server, other than through the SDK (`view-attachment` goes through `client.viewAttachment`).
- HTML or markdown from Todoist data rendered in `src/mcp-apps` without sanitising (`dompurify`).
- A tool that acts on another user's data, or on a project the user can't see, without the API enforcing it.
- A write or destructive action a model could take from a read-only-looking tool.

## Fine

- Logging tool names, durations, counts and error types.
- Test fixtures with fake tokens (`fake-api-key-for-testing`).
