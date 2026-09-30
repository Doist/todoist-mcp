# MCP Apps

This project uses MCP Apps to render interactive UI for tool results (currently `find-tasks-by-date`).

## How It Works

1. The tool returns structured data.
2. The tool metadata includes `_meta.ui.resourceUri`.
3. The server registers the UI resource with `registerAppResource`.
4. MCP hosts fetch the HTML via `resources/read` and render it in a sandboxed iframe.
5. The app connects via the MCP Apps bridge and can call server tools (e.g., `complete-tasks`) or open links.

## Tool call provenance

The task-list app adds `params._meta['todoist.com/ui-source'] = 'task-list'` to its
`find-tasks-by-date` pagination calls and `complete-tasks` calls. Hosts that forward this
metadata let the server distinguish these app requests from untagged tool calls. The marker
does not change the tool arguments or permissions and is not proof of the caller's identity.

Pagination runs automatically after the host supplies the first page. The marker identifies
the source of a tool call, not a click, app render, or unique user. Hosts may omit request
metadata when they forward calls.

## Build Pipeline

- App source: `src/mcp-apps/task-list/`
- Build output: `dist/mcp-apps/index.html` (single-file HTML)
- Build command: `npm run build:apps`
- Full build: `npm run build` (library + apps)
- Dev: `npm run dev` (watch library + apps, restart server on JS/HTML changes)
- App-only dev rebuilds: `npm run dev:apps`

The server computes a content hash of `index.html` at startup and uses it in the `ui://` resource URI for cache-busting.

## Local Preview

```bash
npm run build:apps
open dist/mcp-apps/index.html
```

Without a host bridge, the app will show a loading/connection state.
