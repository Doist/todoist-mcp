# Todoist MCP Server - Development Guidelines

## Tool Schema Design Rules

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

### Output schemas are declared but not advertised

Keep declaring `outputSchema` on every tool that returns `structuredContent` — it types the return, documents the shape, and is checked in tests.

It is **not** sent to clients by default. Output schemas were over half the fixed cost of `tools/list`, and a client only needs one to render a widget or to read a result's shape without calling the tool, so `registerTool` advertises it only for tools carrying widget metadata (`_meta.ui`). Tools return `structuredContent` either way.

A consumer that does read schemas — code generation, where something has to know a result's field names in order to reference them — opts back in with the `output_schemas` feature: `getMcpServer({ ..., features: [{ name: FEATURE_NAMES.OUTPUT_SCHEMAS }] })`.

The consequence for tool authors: the model never sees your output schema, so anything it needs to know about the result belongs in the tool's `description`.

Because the SDK's own output validation only runs for advertised schemas, `registerTool` re-checks output against the declared schema when `NODE_ENV === 'test'`. That only covers calls made through the MCP callback, and tool suites normally call `tool.execute()` directly — so where a tool's output can diverge from its schema at runtime rather than at compile time (an API returning a value outside a declared enum, say), assert it in the tool's own test:

```typescript
expect(() =>
    assertStructuredContentMatchesSchema(findProjects, result.structuredContent),
).not.toThrow()
```

Note that with the schema unadvertised, such a divergence no longer fails a client's tool call — it just means the declared shape is out of date.

## Adding a New Tool

`src/tool-registry.ts` is the single source of truth for the tool surface. `src/mcp-server.ts`, the `tools` export in `src/index.ts`, `scripts/run-tool.ts`, `scripts/validate-schemas.ts` and `src/token-footprint.test.ts` all derive from it, so adding a tool there wires it up everywhere.

1. `src/utils/tool-names.ts` — add the tool name constant
2. `src/tools/<tool-name>.ts` — create the tool definition
3. `src/tool-registry.ts` — add it to `registeredTools`, in the section it belongs to
4. `src/index.ts` — add it to the `tools` object and the named exports (public API)
5. `src/tools/<tool-name>.test.ts` — create the test file
6. `src/tools/tool-annotations.test.ts` — add the annotation expectation entry
7. `src/mcp-server.ts` — add to the `instructions` string **only** if the tool needs cross-tool routing guidance; per-tool detail belongs in the tool's own description

`src/tool-registry.test.ts` enforces that steps 1, 3 and 4 agree with what the server actually registers, so a partial registration fails CI instead of silently degrading `lint:schemas` coverage or leaving the tool unreachable from `run-tool.ts`.

If a new tool pushes the combined fixed cost over `TOKEN_BUDGET` in `src/token-footprint.test.ts`, raise the budget in the same PR and call it out in the description.

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
