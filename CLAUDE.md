# Todoist MCP Server - Development Guidelines

> For repo structure, architecture, shared utilities, and where things live, read [`CODEBASE.md`](./CODEBASE.md) first. This file covers the _rules_; CODEBASE.md is the _map_.

## Tool Schema Design Rules

### Output schemas must never use `.nullable()`

`structuredContent` is sanitised with `removeNullFields` before it leaves the server, so a null can never reach a client. A nullable output field therefore declares a value the tool cannot deliver: the MCP SDK validates the sanitised payload against the declared `outputSchema` and fails the whole call with `Output validation error` the moment that field is stripped.

Declare the field `.optional()` instead and leave the key out of `structuredContent` (`foo: value ?? undefined`) when there is nothing to report. `src/tools/output-schema-nullability.test.ts` enforces this across every registered tool.

### Tool annotations must describe the tool's worst case

The ChatGPT app review rejects the server when any tool's hints understate what it can do. Annotations are per tool, not per `action`/`operation`, so a tool that groups several operations behind an enum must be annotated for the riskiest one. Their definitions:

- **`readOnlyHint: true`** only if the tool retrieves, lists, searches or transforms data without persisting anything or causing a user-visible side effect. Creating a file or a shareable link counts as a side effect.
- **`openWorldHint: true`** if the tool reaches anyone or anything outside the user's own Todoist account: notifying another person (comments, assignments), or producing a public URL. `getMcpAnnotations` defaults it to `false`, so set it explicitly when it applies.
- **`destructiveHint: true`** if the tool deletes, overwrites, replaces prior state, removes someone's access, or is otherwise hard to undo. Additive actions, including sending notifications, are not destructive.

`src/tools/tool-annotations.test.ts` pins every tool's hints, so changing one means updating its entry there.

### Batch write tools report per-item failures, never throw

A tool that writes a list of items settles each item on its own and returns the ones it could not act on in a `failures` array (`FailureSchema`), alongside the successes, even when every item fails. A thrown error hides the items that were written, so callers assume nothing happened and a retry writes them twice. Follow `src/tools/add-projects.ts`:

- `Promise.allSettled` over the items, with each SDK call wrapped in a retry, since the `registerTool` retry never sees a settled failure. A create uses `executeCreateWithRetry`, which retries only a 503: after a 502/504 the item may already exist and the API cannot dedupe a repeat. Updates and lookups use `executeWithRetry`.
- `formatBatchItemError` for each reason, `logBatchFailures` for the log line, `appendFailureSummary` for the text.
- Lookups shared across items (current user, workspace, recipients) fail only the items that need them.
- Sync-backed batches go through `settleSyncCommands` (`src/utils/sync-commands.ts`), which reports each command's outcome.

`src/tools/batch-failures-contract.test.ts` enforces this for every non-read-only tool with a list parameter. The exceptions, including tools not converted yet, are listed there with the reason for each.

### Removing/Clearing Optional Fields

When you need to support clearing an optional field:

1. **Use a special string value** (not `null` - avoids LLM provider compatibility issues, with Gemini in particular)
    - For assignments: use `"unassign"`
    - For other fields: use `"remove"` or similar descriptive string

2. **Handle both legacy and new patterns in runtime logic** for backward compatibility:

    ```typescript
    if (fieldValue === null || fieldValue === 'remove') {
        // Convert to null for API call
        updateArgs = { ...updateArgs, fieldName: null }
    }
    ```

3. **Update schema description** to document the special string value

### Examples from Codebase

- **PR #181**: Fixed `responsibleUser` field - changed from `.nullable()` to using `"unassign"` string
- **Latest commit**: Fixed `deadlineDate` field - changed from `.nullable()` to using `"remove"` string

### Why This Matters

- Ensures compatibility with **all LLM providers** (OpenAI, Anthropic, Gemini, etc.)
- Maintains backward compatibility through dual handling
- Creates self-documenting APIs with explicit action strings

## Testing Requirements

When adding new tool parameters:

1. Add comprehensive test coverage for new fields
2. Test setting values
3. Test clearing values (if applicable)
4. Verify build and type checking pass
5. Run full test suite (all 333+ tests must pass)

## Documentation Requirements

When adding new tool features:

1. Update tool schema descriptions in the source file
2. Update `src/mcp-server.ts` tool usage guidelines
3. Add tests demonstrating the feature
4. Include examples in descriptions where helpful

### Keeping CODEBASE.md accurate

`CODEBASE.md` is a structural map, not a file index. Update it when **structure** changes — not on every new file. Triggers:

- new top-level dir under `src/`, or a new tool-file _category_
- a new broadly-reusable helper in `src/utils/` (the "don't reimplement" list)
- changes to the tool contract, registration flow, auth, or build/test/release tooling

Adding a single tool in an existing category or a narrowly-scoped helper used by one caller does not require an update.

## Running Tools Directly

Use `scripts/run-tool.ts` to execute any tool without the MCP server:

```bash
npx tsx scripts/run-tool.ts <tool-name> '<json-args>'
npx tsx scripts/run-tool.ts --list  # list all tools
```

Examples:

```bash
npx tsx scripts/run-tool.ts add-tasks '{"tasks":[{"content":"Test task"}]}'
npx tsx scripts/run-tool.ts find-tasks '{"searchText":"meeting"}'
npx tsx scripts/run-tool.ts get-overview '{}'
```

Requires `TODOIST_API_KEY` in `.env` (and optionally `TODOIST_BASE_URL`).
