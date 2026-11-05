---
name: write-tests
description: Writes or changes tests in this repository to its quality bar, with the right helpers and layer. Use when adding, fixing or reviewing tests, when a change "needs a test", or when deciding whether a test may change.
---

# Write tests

## Where tests live

- Next to the code: `src/tools/add-tasks.ts` → `src/tools/add-tasks.test.ts`. Vitest, globals on.
- Tool tests call `<tool>.execute(args, mockTodoistApi)`. The mock is a `Mocked<TodoistApi>` with only the methods the tool uses; reset it in `beforeEach` with `vi.resetAllMocks()`.
- `*.sdk.test.ts` runs the real `TodoistApi` against a `customFetch` that answers per request. Use it when the bug or behaviour is in how the SDK is called or its response is read.
- Contract tests scan every registered tool: `tool-annotations.test.ts`, `output-schema-nullability.test.ts`, `batch-failures-contract.test.ts`, `src/tool-registry.test.ts`, `src/token-footprint.test.ts`.
- Agent tooling tests live in `.agents/scripts/` and run copies of the tools in throwaway repos (`.agents/scripts/lib/test-repo.ts`).

## Helpers

From `src/utils/test-helpers.ts`: `createMockTask`, `createMockProject`, `createMockWorkspaceProject`, `createMockSection`, `createMockLabel`, `createMockFilter`, `createMockUser`, `createMappedTask`, `createApiError`, `TEST_ERRORS`, `TEST_IDS`, `TODAY`, `mockPersonalProjectCapacity`, `allApplied`. Use them instead of building objects by hand; extend them when a test needs a new shape.

## The quality bar

Read [references/test-rules.md](references/test-rules.md) before writing or reviewing a test. In short: a test counts only if it can fail. It asserts outcomes, takes expected values from outside the code under test, mocks only real boundaries, and you saw it fail once.

Done when each new test has failed once for the right reason, and then passes.

## When an existing test may change

- **The behaviour changed on purpose** (a feature or a fix): change the assertions that describe it, and say which in the report.
- **A refactor:** only how the test reaches the code (imports, names, call sites). Never its inputs, assertions or snapshots.
- **A snapshot changed:** read the diff line by line before `vitest -u`. It is model-facing text; every change reaches users.
- **Never** to make a failing check pass without a behaviour change: no `.skip`, no deleted test, no looser matcher, no raised budget without a reason in the PR.
