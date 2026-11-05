---
name: build-feature
description: Builds a new tool, parameter or behaviour in thin test-first slices, after settling the open decisions with the owner. Use when asked to "add", "build", "implement", "support" or "create" something, such as a new tool or a new tool parameter.
---

# Build a feature

## 1. Read the closest existing feature

Find the tool most like the one you are building and read it with its test: `src/tools/add-projects.ts` for a batch write, `src/tools/find-tasks.ts` for a read, `src/tools/update-tasks.ts` for an update. Read the rules in `AGENTS.md` ("Tool Schema Design Rules", "Adding a New Tool"). Done when you can name the file you will copy patterns from.

## 2. Settle decisions in one round

List what the request leaves open: naming, input shape, what to return, error cases, annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`), whether it needs a routing line in `src/mcp-server.ts`. Ask the owner all of them at once, each with your recommendation. Don't ask what the code can answer. Done when every decision has an answer.

## 3. Write "done" as checkable behaviours

Write each behaviour as an input and the expected output, for example: "`update-tasks` with `deadlineDate: "remove"` sends `deadlineDate: null` to `updateTask`". Each becomes a test. Done when a test could pass or fail on every one.

## 4. Build in thin slices, test first

For each behaviour: write its test at the public interface (`<tool>.execute(args, mockTodoistApi)`), see it fail, make it pass, run its test file. Follow `write-tests`. Done when every behaviour from step 3 has a passing test you saw fail.

## 5. Update everything the change touches

| You changed                      | Also update                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Added a tool                     | `src/utils/tool-names.ts`, `src/tool-registry.ts`, `src/index.ts` (named exports), `src/tools/tool-annotations.test.ts` |
| A tool writes a list of items    | Per-item `failures` (see "Batch write tools" in `AGENTS.md`); `batch-failures-contract.test.ts` checks it               |
| A clearable optional field       | The `"remove"`/`"unassign"` string, both runtime branches, the schema description                                       |
| Tool or field descriptions       | `npm run eval -- --label before`, then `--label after`; diff `tmp/eval/*.json` (paid models: ask first)                 |
| The tool surface grew            | `src/token-footprint.test.ts` may fail: raise `DEFAULT_TOKEN_BUDGET` only if needed, and say so in the PR               |
| Cross-tool routing               | The `instructions` string in `src/mcp-server.ts`, only if a model needs it to pick between tools                        |
| Output schemas                   | `src/utils/output-schemas.ts`; never `.nullable()` (`output-schema-nullability.test.ts`)                                |
| Structure (new folder or helper) | `CODEBASE.md`, by its "Keeping CODEBASE.md accurate" rules                                                              |

Done when each row that applies is handled.

## 6. Verify and report

Follow `verify`. If the feature needs restructuring first, do that as a separate change with `refactor`.
