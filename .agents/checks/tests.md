# Check: tests

Apply to every change that touches code or tests. The quality bar is `.agents/skills/write-tests/references/test-rules.md`.

## Report

- A test deleted, skipped (`.skip`, `.todo`, `xit`), or with an assertion loosened (`toEqual` → `toMatchObject`, exact args → `toHaveBeenCalled()`), without a behaviour change that explains it.
- A snapshot file (`__snapshots__/`) changed in a refactor, or changed without the diff explaining why the text changed.
- New behaviour with no test, or a test that would still pass with the change undone.
- A new `vi.mock` of an internal module, or a mock of the function under test.
- An expected value computed by the code under test.
- `DEFAULT_TOKEN_BUDGET` raised, or a contract test's exception list grown (`batch-failures-contract.test.ts`), without a reason in the description.
- Config that runs fewer tests: `vite.config.ts` `include`/`exclude`, the scripts in `package.json`, `.github/workflows/ci.yml` steps.

## Fine

- `.not.toHaveBeenCalled()`, guards like `toBeDefined()` before reading a value, and snapshot tests of model-facing text, as the test rules describe.
- A test changing its assertions because the behaviour changed on purpose, when the description says so.
- A refactor changing import paths, names or call sites in tests.
