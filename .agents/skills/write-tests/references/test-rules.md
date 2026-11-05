# Test rules

Calibrated on this repository's tests (1,500+ in `src/`, November 2026). Each rule says what to flag and what is fine, because a rule that flags good tests teaches agents to damage them.

## 1. It can fail

You saw the test fail once: before the fix, or with the feature undone. A test that has never failed may be testing nothing.

## 2. It asserts outcomes

Assert what the caller gets or what reaches the API: `toHaveBeenCalledWith(<exact args>)`, `structuredContent` fields, the text. Flag an assertion that cannot tell right from wrong.

| Flag                                                                                                         | Fine                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toHaveBeenCalled()` as the only evidence the behaviour happened: nothing checks the arguments or the result | `toHaveBeenCalled()` next to assertions on the result or on another call, when those carry the test's point (`src/tools/find-projects.test.ts:439`)                       |
|                                                                                                              | `.not.toHaveBeenCalled()`: proves a call did **not** happen (about 130 in this repo, e.g. a refused move never reaches `moveTasks`)                                       |
| `toBeDefined()` / `toBeTruthy()` as the last word on a value                                                 | The same as a guard right before reading the value's fields (`src/tool-schema-dialect.test.ts:42`, `src/usage-tracking.test.ts:238`); `rejects.toBeDefined()` on an abort |
| A test whose only assertion is that no error was thrown, when the behaviour is a result                      | `resolves.toBeDefined()` when accepting the input **is** the behaviour (a validator that must not reject, `src/tools/set-user-status.test.ts:198`)                        |

Judge a test by its point, the behaviour its name describes. A weak assertion beside the ones that carry that point is fine.

## 3. Expected values come from outside the code under test

Write the expected value out as literals (a lookup table or `it.each` rows are fine), or build it from fixtures. Flag an expectation that calls the code under test, or recomputes the answer the way the code does (the same arithmetic, string building or mapping function).

## 4. Mock only real boundaries

The real boundary here is the Todoist API: the `Mocked<TodoistApi>`, or a `customFetch` in `*.sdk.test.ts`. Other boundaries: the clock (`vi.useFakeTimers`), `globalThis.fetch` in usage tracking, `console`.

| Flag                                                                            | Fine                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **new** `vi.mock` of an internal module, to make setup easier                 | The existing partial mocks (`vi.importActual` plus one replaced function, as for `getTasksByFilter` and `user-resolver`): tolerated, not a pattern to copy |
| Mocking the function the test is about, or one that computes its expected value |                                                                                                                                                            |

New tests should prefer feeding the `Mocked<TodoistApi>` over mocking an internal module.

## 5. No skipped or focused tests

None exist today. `.only` fails in CI (`CI=true`, which `npm run verify` sets too). Don't add `.skip`, `.todo` or `xit` to get green.

## 6. No fixed sleeps

Use fake timers or wait on the event. Fine: a real wait under 50 ms that interleaves concurrent work so the test can check isolation or concurrency limits (`src/usage-tracking.test.ts:147`, the stubbed API delay in `src/tools/update-tasks.test.ts:2040`), or one that proves something did **not** happen.

## 7. Snapshots only for model-facing text

`toMatchSnapshot()` on `result.textContent` is fine: that text is what the model reads, and its exact wording matters. It must sit next to assertions on `structuredContent` or the API call, so the behaviour is not only in the snapshot. Flag a snapshot of structured data, or one that is the test's only assertion. Read every snapshot diff before updating it.

## 8. Reading source files is for contracts

Fine: a test that reads source or config to enforce a rule across the codebase (`src/tool-registry.test.ts` reading `scripts/run-tool.ts`, `src/plugin-config.test.ts` reading `release.config.js`). Flag a test that reads a source file to check one function's behaviour; call the function instead.

## 9. No real user data

Fixtures use made-up names, emails and IDs (`TEST_IDS`, `example.com`). This repository is public.
