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

### Describing output schema fields

Every tool's `outputSchema` is sent to clients on every `tools/list`, and the shared schemas in `src/utils/output-schemas.ts` are inlined once per tool that uses them — so a description on `TaskSchema.id` is paid eight times over.

Describe an output field only where the schema cannot express the thing itself:

- units or formats — `'ISO 8601.'`, `'Bytes.'`, `'e.g. "2h30m".'`
- conventions that are not derivable — `priority: 'p1 is highest, p4 lowest.'`
- unions — `recurring: 'False when not recurring, otherwise the recurrence string.'`
- conditional presence — `workspaceId: 'Undefined for personal projects.'`
- non-obvious meaning — `isUncompletable: 'An organizational header, not a real task.'`

Leave it off when the description would restate the field name (`id`, `projectId`, `name`), or list values an `enum` already carries. Note this is the _output_ side only: input field descriptions are how a model learns to call the tool correctly and should stay as full as they need to be.

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

## Measuring a change to the tool surface

`src/token-footprint.test.ts` tells you what the surface costs. It cannot tell you whether a model can still use it. When you change **tool descriptions, input field descriptions, or the `instructions` block**, measure the behaviour rather than reasoning about it:

```bash
npm run eval -- --label before
# apply your change
npm run eval -- --label after
```

Each run prints a pass rate per scenario per model and writes `tmp/eval/<label>.json`; diff the two. Narrow while iterating with `--scenario <id>`, `--repeats N`, `--models a,b`.

Only the first tool call of a turn is inspected and nothing is executed, so it touches no Todoist data and needs no `TODOIST_API_KEY`. It does call real models, so it is deliberately **not** part of `npm test` — it costs money and is non-deterministic. Auth comes from the standard Anthropic credential chain, so `ant auth login` is enough; no `ANTHROPIC_API_KEY` required.

Two things this has already caught that review and reading did not:

- Trimming the instructions block turned out to **fix** a destructive bug, not merely be safe: asked to delete a workspace project, Haiku 4.5 called `delete-object` directly under the longer instructions and archived first under the shorter ones (0/10 vs 10/10).
- A wording change made while addressing review feedback appeared to regress a scenario by 30 points. It was an artefact of the scenario prompt, not the change — but nothing else would have surfaced the question.

### Adding a scenario

Scenarios live at the top of `scripts/eval-instructions.ts`. Two shapes, and picking the wrong one produces noise that looks like signal:

- **`expect`** — an allowlist, for a rule that names the tool to reach for.
- **`forbid`** — for a rule of the form "don't do X". Prefer this whenever the rule is prohibitive. An allowlist then has to enumerate every legitimate opener, and it will miss some: a model looking a project up with `fetch-object` before deleting it is behaving correctly, and an allowlist that forgot `fetch-object` scores it as a failure.

Make sure a scenario can actually fail. One early scenario listed the destructive tool in its own `expect` and checked an argument condition that was true by construction — it scored 100% while measuring nothing.
