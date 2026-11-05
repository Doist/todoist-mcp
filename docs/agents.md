# Working with coding agents

This repository is set up so coding agents prove their work before they call it done. This page explains the parts, what each one guarantees, and where it stops. It grows as each part lands.

## Layers

1. **Git hooks** run for everyone, people and agents alike, on every commit and push.
2. **`npm run verify`** runs every CI check locally and records a pass.
3. **`AGENTS.md`** tells agents what done means. Claude Code reads it through `CLAUDE.md`; Codex and Cursor read it directly.
4. **Skills** in `.agents/skills/` give step-by-step procedures for recurring work. They load only when a task needs them.

## Rules and what holds them

| Rule                                                          | Held by                                                              | Certainty                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| No commits on `main`                                          | `pre-commit` → `.agents/scripts/branch-guard.sh`                     | Enforced locally; `--no-verify` skips it |
| No pushes to `main`                                           | `pre-push` → `branch-guard.sh`; the "Protect default branch" ruleset | Enforced on GitHub                       |
| Committed files are linted and formatted                      | `pre-commit` → lint-staged; CI                                       | Enforced in CI                           |
| Type check passes before a commit                             | `pre-commit`; CI                                                     | Enforced in CI                           |
| Tests pass before a push                                      | `pre-push`; CI                                                       | Enforced in CI                           |
| Agent tooling never ships in the npm package                  | `.agents/scripts/package-contents.test.ts`                           | Enforced in CI                           |
| `npm run verify` runs what CI runs                            | `.agents/scripts/lib/steps.test.ts` compares it with `ci.yml`        | Enforced in CI                           |
| Run `npm run verify` before calling work done                 | `AGENTS.md`                                                          | Asked                                    |
| Never weaken a check to pass it                               | `AGENTS.md`                                                          | Asked                                    |
| Instructions name only files, links and scripts that exist    | `.agents/scripts/instructions.test.ts`                               | Enforced in CI                           |
| Every skill says when to use it and is linked for Claude Code | `.agents/scripts/instructions.test.ts`                               | Enforced in CI                           |
| Use the matching skill for each task                          | `AGENTS.md`                                                          | Asked                                    |
| Tests meet the quality bar                                    | `.agents/skills/write-tests/references/test-rules.md`                | Asked                                    |

"Enforced in CI" means a pull request cannot merge without it. A local hook alone is a speed bump: `git commit --no-verify` skips it.

## Git hooks

Husky installs the hooks when you run `npm install` (the `prepare` script). Nothing changes in your git configuration beyond the `core.hooksPath` husky has always set.

- **`pre-commit`** refuses a commit on `main`, then runs lint-staged and the type check.
- **`pre-push`** refuses a push to `main`, then runs the tests. It checks `git push --dry-run` too.
- If node is not on `PATH` (some GUI git clients), both hooks still apply the branch rule, skip the checks, and say so. CI runs the same checks.
- The default branch is read from `origin/HEAD`, falling back to `main`.

The release workflow commits and pushes to `main` from GitHub Actions, and husky installs the hooks there as well. The guard therefore skips itself when `GITHUB_ACTIONS=true`. That is the one exemption. Branch protection on GitHub is the real enforcement; the hooks only catch mistakes early.

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

## Skills

Each skill is a short procedure with a check at the end of every step. Agents load one when the task matches its description.

| Skill           | For                                    | Ends with                                                         |
| --------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `verify`        | Any change about to be called done     | `npm run verify`, proof matched to the change, an evidence report |
| `fix-bug`       | Something broken                       | A test that failed on the symptom, the root cause, undo/restore   |
| `build-feature` | A new tool, parameter or behaviour     | Decisions settled up front, test-first slices, a "touches X" map  |
| `refactor`      | Structure changes, behaviour unchanged | Pinned tests, no changed assertions or snapshots                  |
| `write-tests`   | Writing or changing tests              | Tests that failed once, meeting the test rules                    |
| `learn`         | A correction from you                  | A type, lint rule, test or script check that catches the mistake  |

The evidence report rates each claim: **said**, **cited** (a line), **traced** (followed the code), **ran** (a test or command executed it), **seen** (in the running server). "Fixed" or "safe" needs **ran**. Anything less is listed under "Not verified".

The test rules were measured against this repository's tests first, so they accept the patterns that are fine here: `.not.toHaveBeenCalled()`, snapshots of model-facing text, contract tests that read source files.

## How to ask an agent

Give it:

- **the goal**, in a sentence;
- **a done check** that can pass or fail ("`find-tasks` with `labels: ["x"]` returns only tasks labelled x");
- **the proof you want** (a failing test first, a real `npm run tool` call, an eval run);
- **facts you know** and **real constraints** (a deadline, a public API that must not change).

Leave out the method and your theory of the cause. For a vague report, ask the agent to restate it first. Start a new session for unrelated work.

| To start…  | Say                                                         |
| ---------- | ----------------------------------------------------------- |
| a bug fix  | "Fix: <symptom>. Input: <args>. Expected: <x>." (`fix-bug`) |
| a feature  | "Add <behaviour>. Done when <check>." (`build-feature`)     |
| a refactor | "Refactor <area> so <what gets easier>." (`refactor`)       |

Your part: answer the decision questions, and read the evidence report, especially "Not verified".

## Where the tooling lives

- `.agents/scripts/` holds scripts and their tests. It is not under `scripts/` because `scripts/` ships in the npm package.
- The tooling runs straight from TypeScript with Node's type stripping, so it only uses erasable syntax (`.agents/scripts/tsconfig.json` enforces this). `npm run type-check` covers it.
- Tests run in `npm test` and CI. They copy the tools into throwaway git repositories and never touch your checkout. A test helper clears the variables git exports to hooks, since `npm test` itself runs inside `pre-push`.

## Releases

semantic-release publishes from `main` on every merge. The squash-merged PR title decides whether anything ships: `feat:` and `fix:` release, `chore:`, `ci:`, `docs:`, `test:` and `refactor:` do not. Changes to the agent tooling use `chore:` or `ci:`, so they never publish a new version. No path filter is needed.

## What fails open

- No node on `PATH` in a GUI client: the hooks skip lint, the type check and the tests, with a message. The branch rule still applies.
- `git commit --no-verify`: every local hook is skipped. CI and branch protection still apply.
