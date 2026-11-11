# Working with coding agents

This repository is set up so coding agents prove their work before they call it done. This page explains the parts, what each one guarantees, and where it stops. It grows as each part lands.

## Layers

1. **Git hooks** run for everyone, people and agents alike, on every commit and push.
2. **`npm run verify`** runs every CI check locally and records a pass.
3. **`AGENTS.md`** tells agents what done means. Claude Code reads it through `CLAUDE.md`; Codex and Cursor read it directly.
4. **Skills** in `.agents/skills/` give step-by-step procedures for recurring work. They load only when a task needs them.
5. **Review**: fresh reviewers and Doistbot check a finished change against the checks in `.agents/checks/`.
6. **The end-of-turn gate** sends an agent back once when its turn changed code that `npm run verify` has not passed.

## Rules and what holds them

| Rule                                                                                                    | Held by                                                              | Certainty                                |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| No commits on `main`                                                                                    | `pre-commit` and `commit-msg` → `.agents/scripts/branch-guard.sh`    | Enforced locally; `--no-verify` skips it |
| No pushes to `main`                                                                                     | `pre-push` → `branch-guard.sh`; the "Protect default branch" ruleset | Enforced on GitHub                       |
| Committed files are linted and formatted                                                                | `pre-commit` (lefthook, staged files only); CI                       | Enforced in CI                           |
| Type check passes before a commit                                                                       | `pre-commit`; CI                                                     | Enforced in CI                           |
| Tests pass before a push                                                                                | `pre-push`; CI                                                       | Enforced in CI                           |
| Agent tooling and developer scripts never ship in the npm package                                       | `.agents/scripts/package-contents.test.ts`                           | Enforced in CI                           |
| `npm run verify` runs what CI runs                                                                      | `.agents/scripts/lib/steps.test.ts` compares it with `ci.yml`        | Enforced in CI                           |
| Run `npm run verify` before calling work done                                                           | `AGENTS.md`                                                          | Enforced at turn end (once); `AGENTS.md` |
| Never weaken a check to pass it                                                                         | `AGENTS.md`                                                          | Asked                                    |
| Instructions name only files, links and scripts that exist                                              | `.agents/scripts/instructions.test.ts`                               | Enforced in CI                           |
| Every skill says when to use it and is linked for Claude Code                                           | `.agents/scripts/instructions.test.ts`                               | Enforced in CI                           |
| Use the matching skill for each task                                                                    | `AGENTS.md`                                                          | Asked                                    |
| Tests meet the quality bar                                                                              | `.agents/skills/write-tests/references/test-rules.md`                | Asked                                    |
| Review checks say what to report and what is fine, and AGENTS.md links them                             | `.agents/scripts/instructions.test.ts`                               | Enforced in CI                           |
| A finished change gets a task review, a blast-radius review when shared code changed, and a code review | `review-changes` skill                                               | Asked                                    |
| Reviewers never edit the shared checkout                                                                | the reviewer brief; `npm run review:worktree` gives them their own   | Asked                                    |

"Enforced in CI" means a pull request cannot merge without it. A local hook alone is a speed bump: `git commit --no-verify` skips it.

## Git hooks

[Lefthook](https://github.com/evilmartians/lefthook) runs the hooks, configured in `lefthook.yml`. `npm install` installs them into `.git/hooks` (the `prepare` script runs `lefthook install --reset-hooks-path`). If your clone still has husky's `core.hooksPath`, that first install removes it, which lefthook needs; the leftover `.husky/` folder can be deleted.

- **`pre-commit`** refuses a commit on `main`, then lints and formats the staged files (re-staging what the tools fix), runs the schema check when a tool file is staged, and runs the type check. Unstaged changes in a partly staged file are left alone.
- **`commit-msg`** refuses a commit on `main` again. Lefthook runs no pre-commit job when nothing is staged, so without it an empty commit would get past.
- **`pre-push`** refuses a push to `main`, then runs the tests. It checks `git push --dry-run` too.
- If node is not on `PATH` (some GUI git clients), both hooks still apply the branch rule, skip the checks, and say so. CI runs the same checks.
- The default branch is read from `origin/HEAD`, falling back to `main`.

The release workflow commits and pushes to `main` from GitHub Actions, and `npm ci` runs `prepare` there, which installs the hooks. The guard therefore skips itself when `GITHUB_ACTIONS=true`. That is the one exemption. Branch protection on GitHub is the real enforcement; the hooks only catch mistakes early.

## `npm run verify`

One command, every check a pull request's CI runs: lint, format, both type checks, all tests, the build, schema validation and the executable smoke test. It takes about ten seconds, so it always checks the whole tree. Picking only the affected tests would save two seconds and add a way to miss something.

- **Before the checks** it stops if Node is older than `package.json` requires, or if `node_modules` does not match the lockfile. Both make checks fail for reasons unrelated to your change.
- **Only docs changed** since the branch left `main`: it says there is nothing to check. The agent instructions (`AGENTS.md`, `CODEBASE.md`, `docs/agents.md`, `.agents/`) count as code, since a test checks every reference in them.
- **Only CI files changed** (`.github/` workflows other than `ci.yml`, Renovate): it says no local check reads them. `ci.yml` counts as code, since a local test compares verify with it.
- **`MCP_TOKEN_BUDGET`** raises the token budget test's limit. CI never sets it, so verify ignores it and says so.
- **Output:** one line per step. A failing step prints the last 30 lines of its log and the log's path under `.tmp/agents/logs/`.
- **The record:** after a full pass it writes a content hash of every file local checks read (not docs, not CI-only files) to `.tmp/agents/verified.json`. A run that fails, or sees files change while it runs, deletes it. The end-of-turn gate reads it.
- **What it cannot see:** the MCP Apps widgets in a real client, the real Todoist API, and how models use tool descriptions. It prints these after every pass.

If CI gains a step, `.agents/scripts/lib/steps.test.ts` fails until verify gains it too.

## The end-of-turn gate

Every agent's hooks call one script, `.agents/scripts/guard.ts`, so the agents can't drift apart.

- **Turn start** (you send a message): it hashes every file in the checkout, untracked ones included, into `.tmp/agents/turns/`.
- **Turn end** (the agent stops): it compares the tree with the turn's start and with the last `npm run verify` pass. If the turn changed code and verify has not passed on exactly this tree, it sends the agent back once, naming the files. The second time, it lets the agent stop and shows you a note.
- **Passes without a word:** turns that changed nothing, changed only docs, or undid their edits.
- **"Once"** is deliberate: an agent can stop on purpose and say what is unfinished.

| Agent       | Wiring                                                                                                                | Known limits                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `.claude/settings.json`: `UserPromptSubmit` and `Stop`                                                                | Tested in a real session: it sent the agent back once and let it stop the second time.                                                                                                  |
| Codex       | `.codex/hooks.json`: `UserPromptSubmit` and `Stop`                                                                    | Runs only in a trusted project, after each person reviews the hooks in `/hooks`. Versions 0.154 and 0.162.1 ran no project hooks in a linked worktree. Not yet tried in a real session. |
| Cursor      | Runs the Claude Code hooks itself; the command falls back to the git root if Cursor does not set `CLAUDE_PROJECT_DIR` | No Cursor hooks file: a second one would run every hook twice. A test keeps it out. Not yet tried in a real session.                                                                    |

**Other limits:**

- Two sessions in one checkout share its files, so each may be told about the other's edits. Use a worktree per session.
- If the branch's code is back to what `main` has (an undo, a stash, a switch), the turn passes: CI already checked that code.
- Worktrees share the hooks in `.git/hooks`, so the branch rule works in a new worktree at once. Lint, format, types and tests need `npm ci` in that worktree first.
- Without the lefthook binary (no `node_modules` in the main checkout), the hooks print "Can't find lefthook in PATH" and let the commit through.

**Fails open, visibly:** a broken guard, bad input or a checkout without the script lets the turn end and says why in a message. `DISABLE_AGENT_GUARD=1` in the agent's environment turns the gate off for you.

**Speed:** turn start takes under 0.1 seconds on this repository.

## Skills

Each skill is a short procedure with a check at the end of every step. Agents load one when the task matches its description.

| Skill            | For                                    | Ends with                                                                                     |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `verify`         | Any change about to be called done     | `npm run verify`, proof matched to the change, an evidence report                             |
| `fix-bug`        | Something broken                       | A test that failed on the symptom, the root cause, undo/restore                               |
| `build-feature`  | A new tool, parameter or behaviour     | Decisions settled up front, test-first slices, a "touches X" map                              |
| `refactor`       | Structure changes, behaviour unchanged | Pinned tests, no changed assertions or snapshots                                              |
| `write-tests`    | Writing or changing tests              | Tests that failed once, meeting the test rules                                                |
| `learn`          | A correction from you                  | A type, lint rule, test or script check that catches the mistake                              |
| `review-changes` | A change you say is ready              | Task, blast-radius and code reviews; each finding fixed, dismissed with evidence or left open |

The evidence report rates each claim: **said**, **cited** (a line), **traced** (followed the code), **ran** (a test or command executed it), **seen** (in the running server). "Fixed" or "safe" needs **ran**. Anything less is listed under "Not verified".

The test rules were measured against this repository's tests first, so they accept the patterns that are fine here: `.not.toHaveBeenCalled()`, snapshots of model-facing text, contract tests that read source files.

## Review

When you say a change is ready, the agent runs `review-changes`:

- **Task review:** a fresh subagent gets your request in your words, what done means and the decisions made, never the author's reasoning. It looks for what is missing or unrequested. Doistbot can't do this, since it never sees the task.
- **Blast-radius review:** only when shared code changed (`src/utils/`, `src/index.ts` exports, dependencies, build config). It names the one fact that makes the change safe and proves it by running code.
- **Code review:** Doistbot locally (`doistbot review --json`, or `--base <branch below>` in a stack) when version 1.0.12+ is installed and `doistbot doctor` passes. Otherwise one subagent per check in `.agents/checks/`. Doistbot reads `AGENTS.md` and its links, so the checks apply to its pull request reviews too.

Findings are fixed, dismissed with evidence (a line or a test run, never an argument), or left open for you. Reviewers that need to run code get their own worktree from `npm run review:worktree -- <dir>`; the shared one stays read-only.

The checks cover tests, architecture, security, privacy, the tool surface and evidence. Two kinds Todoist uses elsewhere don't apply here: there are no translations and no database migrations. The closest thing to a destructive migration is a tool that deletes or overwrites Todoist data, which the architecture check covers through tool annotations.

A review costs several agent runs, so it runs when you ask, not on every change. A Doistbot run with a failed provider (`providerFailures`) is partial; the agent should say so.

## How to ask an agent

Give it:

- **the goal**, in a sentence;
- **a done check** that can pass or fail ("`find-tasks` with `labels: ["x"]` returns only tasks labelled x");
- **the proof you want** (a failing test first, a real `npm run tool` call, an eval run);
- **facts you know** and **real constraints** (a deadline, a public API that must not change).

Leave out the method and your theory of the cause. For a vague report, ask the agent to restate it first. Start a new session for unrelated work.

| To start…  | Say                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| a bug fix  | "Fix: <symptom>. Input: <args>. Expected: <x>." (`fix-bug`)                                                        |
| a feature  | "Add <behaviour>. Done when <check>." (`build-feature`)                                                            |
| a refactor | "Refactor <area> so <what gets easier>." (`refactor`)                                                              |
| a review   | "Ready for a PR." (`review-changes`)                                                                               |
| a release  | "Ready to release." Check the PR title type: `feat:`, `fix:`, `perf:` and breaking changes publish; others do not. |

Your part: answer the decision questions, and read the evidence report, especially "Not verified".

## Where the tooling lives

- `.agents/scripts/` holds scripts and their tests, next to the skills and review checks. It is not under `scripts/`, which holds the project's own developer scripts, nor a top-level "tools" folder, which would read as MCP tools (`src/tools/`).
- The tooling runs straight from TypeScript with Node's type stripping, so it only uses erasable syntax (`.agents/scripts/tsconfig.json` enforces this). `npm run type-check` covers it.
- Tests run in `npm test` and CI. They copy the tools into throwaway git repositories and never touch your checkout. A test helper clears the variables git exports to hooks, since `npm test` itself runs inside `pre-push`.

## Releases

semantic-release publishes from `main` on every merge. The squash-merged PR title decides whether anything ships: `feat:`, `fix:`, `perf:` and any breaking change (`!`) release; `chore:`, `ci:`, `docs:`, `test:` and `refactor:` do not. Changes to the agent tooling use `chore:` or `ci:`, so they never publish a new version. No path filter is needed.

## What fails open

- No node on `PATH` in a GUI client: the hooks skip lint, the type check and the tests, with a message. The branch rule still applies.
- `git commit --no-verify`: every local hook is skipped. CI and branch protection still apply.
- The end-of-turn gate: any error lets the turn end, with a message saying why. `DISABLE_AGENT_GUARD=1` turns it off.
