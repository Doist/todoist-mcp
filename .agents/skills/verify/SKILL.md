---
name: verify
description: Proves a change works before it is called done, and reports the evidence on a ladder from "said" to "ran". Use when you are about to say "done", "fixed", "works" or "ready", when asked to check or test a change, or before opening a pull request.
---

# Verify a change

## 1. Run the checks

```bash
npm run verify
```

It runs every check CI runs (about ten seconds) and records the pass. Fix every failure; never weaken a check to pass it. Done when it prints `Verified.`

## 2. Prove the change itself

The checks prove nothing broke. Now prove the change does what was asked, with the proof its kind needs:

| Change                                     | Proof                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Tool behaviour (input → API call → output) | A test in `src/tools/<tool>.test.ts` that fails without the change. Run it with the change undone once and see it fail.               |
| How the SDK or the API is called           | A `*.sdk.test.ts` that goes through the real `TodoistApi` with a `customFetch` (see `src/tools/add-projects.sdk.test.ts`).            |
| Tool descriptions or `instructions`        | `npm run eval -- --label before` and `--label after`; diff `tmp/eval/*.json`. It calls paid models: say so before running.            |
| Schema shape                               | `npm run verify` covers `lint:schemas`, `output-schema-nullability.test.ts` and `tool-annotations.test.ts`. Add a test for new rules. |
| Token cost of the tool surface             | `src/token-footprint.test.ts` (in verify). If you raise `TOKEN_BUDGET`, say so in the PR.                                             |
| A real Todoist answer                      | `npm run tool -- <tool> '<json>'`, only on a test account. Check `npm run tool -- user-info '{}'` first. Ask before writes.           |
| MCP Apps widget (`src/mcp-apps`)           | `npm run dev`, open the inspector, call the tool, look at the widget. Take a screenshot. Check the console for errors.                |
| Agent tooling (`.agents/scripts`)          | Its tests in throwaway repos, plus one real run of the hook or command.                                                               |
| Docs only                                  | Every path and command named exists (`ls`, `npm run`).                                                                                |

Check the proof can fail: undo the change and see the test fail, or run the scenario that used to break. Done when you have seen it fail and then pass.

## 3. Report the evidence

Rate every claim on this ladder:

1. **said:** stated without looking.
2. **cited:** the line that shows it (`path:line`).
3. **traced:** followed the code path through each call.
4. **ran:** a test or command executed the code and showed the result.
5. **seen:** observed in the running server or widget.

Claims about behaviour ("fixed", "works", "safe", "no regressions") need **ran** or higher. A fact the code shows needs **cited**. Anything lower goes under **Not verified**, with why.

For a change to code others rely on (shared helpers in `src/utils/`, `src/tool-helpers.ts`, schemas in `output-schemas.ts`, the public API in `src/index.ts`), name the one fact that makes it safe, and how you proved it.

Report format:

```
What changed: <one line>
Verified:
- <claim> — ran: <command or test>, <what it showed>
Not verified:
- <claim> — <why>
Safe because: <the one fact>, <how you proved it>   (only for shared code)
```
