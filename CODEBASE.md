# CODEBASE.md — Repo Map

> **Purpose:** a ~2000-token orientation file so Claude (and humans) can navigate
> this repo without exploring. Describes _what is where_; `CLAUDE.md` describes
> _how to change things_. Update when structure shifts, not when tools are added.

## What this project is

`@doist/todoist-mcp` is an **MCP (Model Context Protocol) server** that exposes
Todoist as tools for LLMs. It wraps `@doist/todoist-sdk` and publishes two
binaries:

- `todoist-mcp` → `dist/main.js` — stdio MCP server (primary)
- `todoist-mcp-http` → `dist/main-http.js` — Express HTTP wrapper

TypeScript · ESM-only · Node >=24 · npm >=11 · `zod` v4 for schemas · MCP SDK ≥1.25.

## Top-level layout

```
/
├─ src/                   # All source. See tree below.
├─ scripts/               # run-tool.ts (direct tool invocation), validate-schemas.ts, test-executable.cjs, bump-plugin-version.mjs (semantic-release plugin manifest sync)
├─ .claude-plugin/        # Claude Code plugin manifest (plugin.json) + marketplace entry (marketplace.json)
├─ .mcp.json              # MCP server declaration consumed by the Claude Code plugin (HTTP transport → ai.todoist.net/mcp)
├─ dist/                  # Build output (Vite). Never edit.
├─ CLAUDE.md              # Prescriptive rules (schema design, testing, field clearing)
├─ AGENTS.md              # Fuller agent guidelines — includes the authoritative new-tool checklist
├─ CODEBASE.md            # This file — descriptive map
├─ package.json           # See Scripts section
└─ .github/workflows/     # ci.yml, release.yml (semantic-release), check-semantic-pull-request.yml
```

## `src/` tree

```
src/
├─ main.ts                    # stdio entry: dotenv → getMcpServer() → StdioServerTransport
├─ main-http.ts               # Express entry: thin bootstrap — reads env, builds the app, listen()
├─ http-app.ts                # createHttpApp(): the Express app + middleware chain (Host/Origin guard scoped to /mcp). Pure/side-effect-free so it's testable
├─ index.ts                   # Public package exports — a curated subset of tools + helpers + types. NOT the full registry.
├─ mcp-server.ts              # getMcpServer() factory. **Authoritative tool registry** — imports every tool, calls registerTool() for each, registers productivity-analysis prompt, contains the giant `instructions` string shown to the LLM
├─ mcp-helpers.ts             # registerTool(), FEATURE_NAMES, output formatting, retry wrapping
├─ usage-tracking.ts          # Shared Todoist request headers + SDK customFetch wrapper for MCP usage attribution
├─ todoist-tool.ts            # TodoistTool<Params, Output> contract (the tool interface)
├─ tool-helpers.ts            # Shared transforms: mapTask, fetchAllPages, toWildcardQuery, compileWildcardQuery + matchesWildcardQuery (client-side name match), resolveInboxProjectId, isInboxProjectId, isPersonalProject, isWorkspaceProject. Re-exports filter-helpers.
├─ filter-helpers.ts          # appendToQuery, buildResponsibleUserQueryFilter, resolveResponsibleUser
├─ tool-execution-error.ts    # ToolExecutionError: wraps SDK errors with user/system classification
├─ prompts/                   # MCP prompts (productivity-analysis)
├─ middleware/                # require-trusted-host (Host/Origin allowlist, DNS-rebinding protection), require-valid-todoist-token (HTTP auth)
├─ mcp-apps/                  # React UI widgets (task list). Built separately. Ignore unless task mentions widgets.
├─ tools/                     # 40+ tool definitions. One file = one tool. Each <tool>.test.ts sits alongside its tool; snapshots in tools/__snapshots__/. See catalog.
└─ utils/                     # Reusable helpers. See catalog.
```

## Architecture flow

1. `main.ts` reads `TODOIST_API_KEY` (and optional `TODOIST_BASE_URL`) from env.
2. Calls `getMcpServer()` in `mcp-server.ts`, which:
    - instantiates a shared tracked `TodoistApi` client via `usage-tracking.ts`,
    - iterates every imported tool object and calls
      `registerTool(server, tool, client, features)` from `mcp-helpers.ts`,
    - registers the `productivity-analysis` prompt,
    - returns the configured `McpServer`.
3. `registerTool()` unwraps the `TodoistTool` contract, wires MCP's
   `server.registerTool()` with the Zod params/output, and wraps `execute()`
   with retry logic (`utils/retry.ts`) and `ToolExecutionError` formatting.
4. Each tool's `execute(args, client)` calls the Todoist SDK and returns
   `{ textContent?, structuredContent?, contentItems? }`.

## Tool contract (`src/todoist-tool.ts`)

```ts
type TodoistTool<
    Params extends z.ZodRawShape,
    Output extends z.ZodRawShape = Record<string, never>,
> = {
    name: string
    description: string
    parameters: Params // Zod raw shape (NOT z.object)
    outputSchema?: Output // Zod raw shape; omit for tools that return only content blocks (e.g. view-attachment)
    annotations: {
        // required hints
        readOnlyHint: boolean
        destructiveHint: boolean
        idempotentHint: boolean
    }
    _meta?: Record<string, unknown>
    execute: (
        args: z.infer<z.ZodObject<Params>>,
        client: TodoistApi,
    ) => Promise<{
        textContent?: string
        structuredContent?: z.infer<z.ZodObject<Output>>
        contentItems?: ContentBlock[]
    }>
}
```

**Canonical examples:**

- `src/tools/add-tasks.ts` — batch create, array input w/ `.max(25)`, success/failure aggregation
- `src/tools/find-tasks.ts` — filter + pagination + cursor pattern
- `src/tools/update-tasks.ts` — partial updates, `"remove"` clearing pattern

## Tools catalog (grouped)

Tool files are flat in `src/tools/` (kebab-case). Don't enumerate — grep. Current domains:

- **Tasks** — add/update/complete/uncomplete/reschedule/find/find-by-date/find-completed/manage-assignments
- **Projects** — add/update/find/project-management/project-move + health/activity-stats/insights
- **Sections** — add/update/find
- **Comments** — add/update/find (attachments supported; see `view-attachment`)
- **Labels** — add/find
- **Filters** (saved Todoist filters) — add/update/find
- **Reminders** — add/update/find
- **Workspace/collab** — list-workspaces, find-project-collaborators, user-info, get-workspace-insights
- **Productivity/activity** — get-overview, get-productivity-stats, find-activity
- **Generic** — delete-object, fetch, fetch-object, search, reorder-objects, view-attachment

New tool? Full checklist in `AGENTS.md`. Short version: copy `add-tasks.ts`; import + register in `src/mcp-server.ts`; add tool name to `src/utils/tool-names.ts`; add to `src/index.ts` (exports) and `scripts/run-tool.ts` (direct-run registry); add annotation entry to `src/tools/tool-annotations.test.ts`; write `<tool-name>.test.ts` alongside it.

## `src/utils/` catalog — don't reimplement

- `constants.ts` — `ApiLimits` (batch sizes, max string lengths)
- `tool-names.ts` — `ToolNames` enum of every registered tool name
- `output-schemas.ts` — Reusable Zod schemas: TaskSchema, ProjectSchema, SectionSchema, CommentSchema, etc.
- `schema-helpers.ts` — Zod builders used across tools
- `priorities.ts` — `"p1"`–`"p4"` ↔ SDK integer conversion (**strings only in tool I/O**)
- `duration-parser.ts` — `"2h30m"` ↔ ms, plus `formatDuration`
- `date.ts` — date parsing/formatting (ISO, Todoist strings)
- `filter-resolver.ts` — resolve saved filter by id/name to raw filter string
- `labels.ts` — label name normalization
- `colors.ts` — Todoist color name ↔ key
- `reminder-schemas.ts` — reminder-specific shapes
- `assignment-validator.ts` — validate collaborator assignments
- `user-resolver.ts` / `workspace-resolver.ts` — resolve user/workspace refs
- `response-builders.ts` — `summarizeTaskOperation`, `summarizeBatch`, `previewTasks` (keep output messages consistent)
- `retry.ts` — `executeWithRetry()` used inside `registerTool`
- `sanitize-data.ts` — HTML sanitization (dompurify) for comment content
- `validate-todoist-token.ts` — token validation for HTTP middleware
- `test-helpers.ts` — `createMockTask`, `createMockProject`, `createMockSection`, `TEST_IDS`, `TODAY`

## Todoist SDK + auth

- Client: `new TodoistApi(apiKey, baseUrl?)` — created once per server in `mcp-server.ts`, passed into every `execute()`.
- Auth: `TODOIST_API_KEY` env var, validated at startup. Both stdio and HTTP use this; the HTTP server passes it through `requireValidTodoistToken({ type: 'static', apiKey })` middleware (`src/middleware/require-valid-todoist-token.ts`). The middleware _also_ supports a per-request bearer-token mode, but `main-http.ts` does not wire that up today.
- HTTP request guard: `requireTrustedHost` (`src/middleware/require-trusted-host.ts`) is scoped to the `/mcp` routes, running ahead of `express.json()` and `requireValidTodoistToken`, validating the `Host` and `Origin` headers against a trusted-hostname allowlist (loopback defaults + `ALLOWED_HOSTS` + a concrete non-loopback `HOST`). This is DNS-rebinding protection: it blocks malicious websites from reaching the loopback server with the operator's token. `/health` is intentionally unguarded so deployment probes (which use the target's private IP in the Host header) stay reachable. The allowlist is built by `buildAllowedHosts(HOST, ALLOWED_HOSTS)` in the same module; shared host helpers live in `src/utils/host.ts`. The app is assembled by `createHttpApp()` in `src/http-app.ts` (a pure module, no side effects, so the middleware chain is testable); `src/main-http.ts` is a thin bootstrap that reads env and calls `listen()`.
- Optional `TODOIST_BASE_URL` for staging/dev APIs.
- Errors: wrap SDK throws in `ToolExecutionError` (classify user vs system) — `registerTool` handles this automatically.

## Testing

- **Runner:** `vitest` with globals. `npm test` / `npm run test:watch` / `npm run test:coverage`.
- **Location:** co-located at `src/tools/<tool>.test.ts`; utility tests alongside (`src/utils/retry.test.ts`, etc.).
- **Mocks:** `vi.fn()` against `TodoistApi` methods. Use factories from `src/utils/test-helpers.ts` — do NOT hand-build mock entities.
- **Coverage:** 333+ tests currently. All must pass before commit.

## Build & release

- **Build:** Vite. `npm run build` = `build:lib` (lib bundle → `dist/`) + `build:apps` (React widgets → `dist/mcp-apps/`).
- **Dev:** `npm run dev` (stdio + inspector, auto-rebuild) or `npm run dev:http`.
- **Type-check:** `npm run type-check` (runs `tsc --noEmit`).
- **Format/lint:** `npm run format:check` / `npm run format:fix` — uses **oxlint + oxfmt**, not eslint/prettier.
- **Schema lint:** `npm run lint:schemas` — validates every tool's Zod schema via `scripts/validate-schemas.ts`. Runs automatically on `src/tools/*.ts` via lint-staged.
- **Release:** `semantic-release` on merge to `main` (GitHub Actions). Commits must follow Conventional Commits — enforced by `check-semantic-pull-request.yml`. The pipeline runs `scripts/bump-plugin-version.mjs` (via `@semantic-release/exec`) to keep `.claude-plugin/plugin.json` in lockstep with `package.json`; both files are committed back together.
- **Husky:** `prepare` script installs Husky. Actual commit-time behavior is in `.husky/pre-commit`, which runs `lint-staged` then `npm run type-check`.

## Run a tool without MCP

```bash
npx tsx scripts/run-tool.ts <tool-name> '<json-args>'
npx tsx scripts/run-tool.ts --list
```

Needs `TODOIST_API_KEY` in `.env`.

## Conventions (quick)

- Filenames: **kebab-case** (`find-completed-tasks.ts`)
- No barrel files — import directly from the file
- Priority: **`"p1"`–`"p4"` strings only**, never integers
- Clearing optional fields: special strings `"remove"` / `"unassign"`, never `null` (Gemini compatibility — see `CLAUDE.md`)
- Tool parameters: Zod **raw shape** (`{ foo: z.string() }`), not `z.object({...})`
- Every new tool: register in `src/mcp-server.ts`, add to `src/utils/tool-names.ts`, `src/index.ts`, and `scripts/run-tool.ts`; add annotation entry to `src/tools/tool-annotations.test.ts`; write a `<tool>.test.ts` — full checklist in `AGENTS.md`

## Start here if new

1. `src/mcp-server.ts` — see every tool wired up
2. `src/todoist-tool.ts` — the tool contract
3. `src/mcp-helpers.ts` — `registerTool()` behavior
4. `src/tools/add-tasks.ts` — canonical write tool
5. `src/tools/find-tasks.ts` — canonical read tool
6. `src/tool-helpers.ts` + `src/utils/` — what's already built
7. `CLAUDE.md` — rules you must follow
