# Check: architecture

Rules lint and types can't express. Most have a contract test; report where a change works around one.

## Report

- A tool added or removed outside `src/tool-registry.ts`, or missing from `src/utils/tool-names.ts` or the named exports in `src/index.ts`.
- A change to anything exported from `src/index.ts` (names, parameters, return shapes) in a PR not titled `feat!:` or `fix!:`. Other packages depend on it.
- `.nullable()` in an output schema, or `null` as the way to clear an input field instead of `"remove"`/`"unassign"` (see `AGENTS.md`).
- A batch write tool that throws on one item instead of returning `failures`.
- Tool annotations that understate the worst case: a tool that can delete, overwrite or notify someone, marked otherwise.
- A barrel file, or a helper that duplicates one in `src/utils/` or `src/tool-helpers.ts`.
- Per-tool guidance added to the `instructions` string in `src/mcp-server.ts`; it belongs in the tool's description.

## Fine

- Exceptions listed with a reason in the contract test that enforces the rule.
- New exports in `src/index.ts` (additive) in a `feat:` PR.
