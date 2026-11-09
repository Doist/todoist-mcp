# Todoist MCP Server - Development Guidelines

> For repo structure, architecture, shared utilities, and where things live, read [`CODEBASE.md`](./CODEBASE.md) first. This file covers the _rules_; CODEBASE.md is the _map_.

## Definition of done

- **Done means proven:** a test that failed before the change and passes after, or the tool's real answer (`npm run tool`, on a test account). For a refactor: tests that pin the behaviour, passing before and after. Reading code or a passing compile is not proof.
- **Run `npm run verify` before calling a change done.** It runs every check CI runs, in about ten seconds, and records the pass. It prints what it cannot see, and says when only docs changed and there is nothing to check.
- **Never weaken a check to pass it.** Don't skip, delete or loosen tests, edit lint, type or test config to get green, or use `--no-verify`. If a check looks wrong, say so and stop.
- **Report honestly:** what ran, what it showed, and what you did not verify.

## Skills

Use the matching skill without being asked. They live in `.agents/skills/` (Claude Code reads them through `.claude/skills/`).

- `verify`: before saying a change is done, fixed or ready.
- `fix-bug`: something is broken or wrong.
- `build-feature`: a new tool, parameter or behaviour.
- `refactor`: changing structure without changing behaviour. Other tasks send restructuring here, as a separate change.
- `write-tests`: writing or changing tests; `.agents/skills/write-tests/references/test-rules.md` is the quality bar.
- `learn`: after a correction, to turn it into a check.
- `review-changes`: when the owner says a change is ready for a PR, or asks for a review.

## Review checks

Reviewers, Doistbot included, apply these to every change:

- [Tests](.agents/checks/tests.md): not weakened, new behaviour tested.
- [Architecture](.agents/checks/architecture.md): rules lint can't express.
- [Security](.agents/checks/security.md): tokens, the HTTP guard, fetched URLs.
- [Privacy and secrets](.agents/checks/privacy.md): this repository is public.
- [Tool surface](.agents/checks/tool-surface.md): what models see.
- [Evidence](.agents/checks/evidence.md): claims backed by what ran.

## Git hooks and agent tooling

- Commits and pushes to `main` are refused by the git hooks. Work on a branch.
- When a turn changes code that `npm run verify` has not passed, the end-of-turn hook (Claude Code, Codex, Cursor) sends you back once. Run verify, or stop on purpose and say what is unverified.
- Agent tooling lives in `.agents/scripts/`, never in `scripts/`, which holds the project's own developer scripts. Neither ships in the npm package; `.agents/scripts/package-contents.test.ts` enforces it.
- How it all fits together: [`docs/agents.md`](docs/agents.md).

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
4. `src/index.ts` — add it to the named exports (public API); the `tools` object there derives from the registry
5. `src/tools/<tool-name>.test.ts` — create the test file
6. `src/tools/tool-annotations.test.ts` — add the annotation expectation entry, choosing hints by "Tool annotations must describe the tool's worst case" above
7. `src/mcp-server.ts` — add to the `instructions` string **only** if the tool needs cross-tool routing guidance; per-tool detail belongs in the tool's own description

`src/tool-registry.test.ts` enforces that steps 1, 3 and 4 agree with what the server actually registers, so a partial registration fails CI instead of silently degrading `lint:schemas` coverage or leaving the tool unreachable from `run-tool.ts`.

If a new tool pushes the combined fixed cost over `DEFAULT_TOKEN_BUDGET` in `src/token-footprint.test.ts`, raise the budget in the same PR and call it out in the description.

## Testing Requirements

When adding new tool parameters:

1. Add comprehensive test coverage for new fields
2. Test setting values
3. Test clearing values (if applicable)
4. Run `npm run verify`

## Documentation Requirements

When adding new tool features:

1. Update tool schema descriptions in the source file
2. Update the `instructions` in `src/mcp-server.ts` only for cross-tool routing guidance
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

## Measuring a change to the tool surface

`src/token-footprint.test.ts` tells you what the surface costs. It cannot tell you whether a model can still use it. When you change **tool descriptions, input field descriptions, or the `instructions` block**, measure the behaviour rather than reasoning about it:

```bash
npm run eval -- --label before
# apply your change
npm run eval -- --label after
```

Each run prints a pass rate per scenario per model and writes `tmp/eval/<label>.json`; diff the two. Narrow while iterating with `--scenario <id>`, `--repeats N`, `--models a,b`.

Nothing is executed against Todoist, so it touches no Todoist data and needs no `TODOIST_API_KEY`. It does call real models, so it is deliberately **not** part of `npm test` — it costs money and is non-deterministic.

Each attempt is judged on one call. Usually that is the first, with two exceptions, both there because a model doing the right thing was being scored as a failure:

- **Context tools** (`CONTEXT_TOOLS`, currently just `user-info`) are answered with a canned result and judging moves to the next call. A model cannot turn "last week" into a date range without knowing today's date and the user's timezone, so asking first is correct — but an `expect` allowlist naming the tool under test cannot also name every reasonable lookup that precedes it.
- **A turn carrying several calls** is judged on the first one that is not a context tool, since the order between "ask for the date" and "query the log" is arbitrary. A forbidden call outranks that, being the whole point of a forbid rule.

Two things this has already caught that review and reading did not:

- Trimming the instructions block turned out to **fix** a destructive bug, not merely be safe: asked to delete a workspace project, Haiku 4.5 called `delete-object` directly under the longer instructions and archived first under the shorter ones (0/10 vs 10/10).
- A wording change made while addressing review feedback appeared to regress a scenario by 30 points. It was an artefact of the scenario prompt, not the change — but nothing else would have surfaced the question.

### Authenticating

The harness uses the Anthropic SDK's standard credential chain, so either of these works:

- **`ANTHROPIC_API_KEY`** in your environment — a key from the [Anthropic Console](https://platform.claude.com). Create it in a workspace you can put a spend limit on.
- **An OAuth profile**, which avoids managing a key at all. `ant` is Anthropic's CLI ([anthropics/anthropic-cli](https://github.com/anthropics/anthropic-cli)); `ant auth login` opens a browser and stores a profile under `~/.config/anthropic/` that the SDK picks up automatically.

    ```bash
    brew install anthropics/tap/ant                        # macOS
    go install github.com/anthropics/anthropic-cli/cmd/ant@latest   # or from source (Go 1.22+)
    # Linux/WSL: grab the tarball for your arch from the releases page above
    ant auth login
    ```

    On a machine with no browser, `ant auth login --no-browser` prints a URL and takes the code back in the terminal.

Note the two do not compose: a set `ANTHROPIC_API_KEY` **silently overrides** any OAuth profile, so requests go to whichever org that key belongs to. `ant auth status` shows which credential source won.

### Adding a scenario

Scenarios live at the top of `scripts/eval-instructions.ts`. Two shapes, and picking the wrong one produces noise that looks like signal:

- **`expect`** — an allowlist, for a rule that names the tool to reach for.
- **`forbid`** — for a rule of the form "don't do X". Prefer this whenever the rule is prohibitive. An allowlist then has to enumerate every legitimate opener, and it will miss some: a model looking a project up with `fetch-object` before deleting it is behaving correctly, and an allowlist that forgot `fetch-object` scores it as a failure.

Make sure a scenario can actually fail. One early scenario listed the destructive tool in its own `expect` and checked an argument condition that was true by construction — it scored 100% while measuring nothing.

The opposite mistake is just as expensive: `completed-via-activity` reported 0% on Sonnet 5 for months while the model was answering it perfectly, because it opened with `user-info` and the allowlist only named `find-activity`. If a scenario sits at 0% on a capable model, check what it is actually calling before rewriting any tool description — a failure with a plausible-looking first call is worth a moment's suspicion. Adding the lookup to `expect` is not the fix; the judge would then pass on the lookup alone and check nothing. Add it to `CONTEXT_TOOLS` with a stub result instead.
