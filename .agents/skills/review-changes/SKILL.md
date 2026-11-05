---
name: review-changes
description: Reviews a finished change with fresh reviewers (a task review, a blast-radius review for shared code, and Doistbot or per-check subagents), then confirms each finding before acting on it. Use when the owner says a change is "ready for a PR", "ready to merge" or ready for a release, or asks for "a review".
---

# Review a change

Reviews cost several agent runs. Run them when the owner says the change is ready, or asks. During work, `npm run verify` is the check.

## 1. Prepare

1. `npm run verify` passes.
2. Run `git status`. Untracked files reach the reviewers and Doistbot's model providers. Ask the owner about any that don't belong to the change. Never `git add -A` to tidy up.
3. Write the brief from [references/reviewer-brief.md](references/reviewer-brief.md): the task in the owner's words, what done means, the decisions made. Never your own opinion of the change, or your reasoning.

Done when the brief is written and the tree holds only the change.

## 2. Run the reviews in parallel

- **Task review**, always: a fresh subagent with the brief and the diff. It looks for missing pieces, unrequested changes, unhandled cases, tests that would pass with the feature broken, and, in a refactor, any changed test input, assertion or snapshot. Doistbot can't do this: it never sees the task.
- **Blast-radius review**, when the change alters code others rely on: `src/utils/`, `src/tool-helpers.ts`, `src/utils/output-schemas.ts`, the exports of `src/index.ts`, `package.json` dependencies, build or CI config. It names the one fact that makes the change safe and proves it by running code. It looks where text search stops: SDK versions in `package-lock.json`, the shape of API responses, what clients see in `tools/list`, other packages importing `src/index.ts`.
- **Code review**: Doistbot if it is set up (below). Otherwise one subagent per relevant check in `.agents/checks/`, each with the brief and that check.

Every brief says: **the shared working tree is read-only.** A reviewer that needs to run or break code makes its own copy with `npm run review:worktree -- <dir>`, then `npm ci` in it, and removes it after.

## 3. Doistbot locally

Use it when `doistbot --version` prints 1.0.12 or newer and `doistbot doctor` succeeds. Otherwise use the per-check subagents and tell the owner Doistbot was skipped.

- Off the default branch: `doistbot review --json`. In a stack: `doistbot review --base <branch below> --json`. Both cover commits, staged and unstaged edits, and untracked files. Nothing needs staging.
- Not `doistbot review staged`: it skips the branch's commits and still reports `verified`.
- Read `status`, `verified` and `providerFailures` first. An unverified review, or one with a failed provider, is partial: say so, and cover that gap with a subagent.
- It runs before the Doistbot review on the pull request, not instead of it.

## 4. Confirm each finding

Reviewers rate findings on the `verify` ladder. Take each to the rung its claim needs: the cited line for what the diff shows, a failing test or command for a behaviour claim. Then:

- **fix** it,
- **dismiss** it with evidence at that rung (the line, the test output), never an argument, or
- **leave it open** for the owner, saying what would settle it.

Look again when new evidence appears. Done when every finding has one of the three.

## 5. Fix, verify, re-review

Fix, then `npm run verify`. A large fix gets its own task review. Report the findings with what happened to each, in the `verify` report format.
