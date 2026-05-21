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

## Adding a New Tool

When adding a new tool, it must be registered in **all** of these locations:

1. `src/utils/tool-names.ts` — add tool name constant
2. `src/tools/<tool-name>.ts` — create tool definition
3. `src/mcp-server.ts` — import, register with `registerTool()`, and add to LLM `instructions` string
4. `src/index.ts` — import and add to both the `tools` object and the named exports
5. `scripts/run-tool.ts` — import and add to the `tools` record
6. `src/tools/__tests__/tool-annotations.test.ts` — add annotation expectation entry
7. `src/tools/__tests__/<tool-name>.test.ts` — create test file
8. `src/token-footprint.test.ts` — import the tool and append it to the `allTools` array so the token baseline keeps measuring the full surface. If the new tool's schema/description is large enough to push the combined fixed cost over `TOKEN_BUDGET`, raise the budget in the same PR and call it out in the description.

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
