---
name: refactor
description: Changes the structure of code without changing its behaviour, with the current behaviour pinned by tests first. Use when asked to "refactor", "clean up", "simplify", "extract", "rename", "move" or "deduplicate" code, or when another task needs restructuring first.
---

# Refactor

A refactor changes structure, not behaviour. Bugs included: if you find one, note it for a separate fix and keep it as it is.

## 1. Pin the current behaviour

Find the tests that cover the code at its public interface: the tool's `execute`, or the exported helper. Where a behaviour has no test, add one that passes **now**, asserting what the code does today. Run them. Done when every behaviour you will touch has a passing test.

## 2. Delete dead code first

Remove code nothing reaches, if you can prove it: no caller (`rg` for every name, including string uses in `src/tool-registry.ts` and `scripts/`), no export in `src/index.ts` (the public API). Run the tests. Done when they pass.

## 3. Move one concept at a time

Make one structural change, run the pinned tests, repeat. Migrate every caller and delete the old API; no shims left behind. Done when the tests pass after each step and no caller uses the old shape.

## 4. Leave the tests alone

Existing tests may change how they reach the code: import paths, names, call sites. They may not change their inputs or their assertions. A snapshot (`__snapshots__/`) must not change at all. If one needs to, the behaviour changed: stop and say so.

## 5. Keep it only if it reads better

Name what got easier to read or change. If you can't, revert. Done when you can say it in one sentence.

## 6. Verify

`npm run verify`, then report with the `verify` format. Say which tests pinned the behaviour, and confirm `git diff` shows no change to any assertion or snapshot.
