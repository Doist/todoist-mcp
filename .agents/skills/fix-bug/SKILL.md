---
name: fix-bug
description: Fixes a bug by reproducing it in a failing test first, then making the smallest change that turns it green. Use when something is "broken", "wrong", "fails", "doesn't work", throws an error, or a user or issue reports a bug.
---

# Fix a bug

## 1. Restate the symptom

Write down what happens, what should happen, and the input that triggers it. If the report is vague, restate it to the owner and ask before going further. Done when the symptom fits in one sentence.

## 2. Reproduce it in a test

Write a test that fails on the exact symptom, at the lowest layer that shows it:

- a helper in `src/utils/` → its `*.test.ts` next to it;
- a tool's input handling or output → `src/tools/<tool>.test.ts`, calling `<tool>.execute(args, mockTodoistApi)`;
- how the SDK is called or a response is parsed → a `*.sdk.test.ts` with the real `TodoistApi` and a `customFetch`.

Follow `write-tests` for helpers and the quality bar. Run the test and see it fail **for the reason in step 1**, not a typo or a missing mock. Done when the failure message describes the bug.

## 3. Find the root cause

Trace from the symptom to the first place the data goes wrong. Name it with `path:line`. A fix at the symptom (a special case, a retry, a try/catch) is not a root cause. Done when you can say why the code does what it does.

## 4. Make the smallest fix

Change only what the root cause needs. Note other bugs you find for a separate fix; don't fix them here. Restructuring goes to `refactor`, as its own change.

## 5. Prove the fix is needed

Undo the fix: the test fails. Restore it: the test passes. Then `npm run verify`. Done when you have seen both and verify prints `Verified.`

## When it doesn't work

After three fixes that didn't turn the test green, stop. Your model of the bug is wrong. Re-read the failing output, question the test, and list what you have ruled out before trying again. Tell the owner if you're stuck.

## Report

Use the `verify` report format. Include the test name, the root cause line, and the undo/restore result.
