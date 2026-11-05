# Working with coding agents

This repository is set up so coding agents prove their work before they call it done. This page explains the parts, what each one guarantees, and where it stops. It grows as each part lands.

## Layers

1. **Git hooks** run for everyone, people and agents alike, on every commit and push.
2. **`npm run verify`** runs every CI check locally and records a pass.
3. **`AGENTS.md`** tells agents what done means. Claude Code reads it through `CLAUDE.md`; Codex and Cursor read it directly.

## Rules and what holds them

| Rule                                          | Held by                                                              | Certainty                                |
| --------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| No commits on `main`                          | `pre-commit` → `.agents/scripts/branch-guard.sh`                     | Enforced locally; `--no-verify` skips it |
| No pushes to `main`                           | `pre-push` → `branch-guard.sh`; the "Protect default branch" ruleset | Enforced on GitHub                       |
| Committed files are linted and formatted      | `pre-commit` → lint-staged; CI                                       | Enforced in CI                           |
| Type check passes before a commit             | `pre-commit`; CI                                                     | Enforced in CI                           |
| Tests pass before a push                      | `pre-push`; CI                                                       | Enforced in CI                           |
| Agent tooling never ships in the npm package  | `.agents/scripts/package-contents.test.ts`                           | Enforced in CI                           |
| `npm run verify` runs what CI runs            | `.agents/scripts/lib/steps.test.ts` compares it with `ci.yml`        | Enforced in CI                           |
| Run `npm run verify` before calling work done | `AGENTS.md`                                                          | Asked                                    |
| Never weaken a check to pass it               | `AGENTS.md`                                                          | Asked                                    |

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
- **Only docs changed** since the branch left `main`: it says there is nothing to check.
- **Only CI files changed** (`.github/` workflows other than `ci.yml`, Renovate): it says no local check reads them. `ci.yml` counts as code, since a local test compares verify with it.
- **`MCP_TOKEN_BUDGET`** raises the token budget test's limit. CI never sets it, so verify ignores it and says so.
- **Output:** one line per step. A failing step prints the last 30 lines of its log and the log's path under `.tmp/agents/logs/`.
- **The record:** after a full pass it writes a content hash of every file local checks read (not docs, not CI-only files) to `.tmp/agents/verified.json`. A run that fails, or sees files change while it runs, deletes it. The end-of-turn gate reads it.
- **What it cannot see:** the MCP Apps widgets in a real client, the real Todoist API, and how models use tool descriptions. It prints these after every pass.

If CI gains a step, `.agents/scripts/lib/steps.test.ts` fails until verify gains it too.

## Where the tooling lives

- `.agents/scripts/` holds scripts and their tests. It is not under `scripts/` because `scripts/` ships in the npm package.
- The tooling runs straight from TypeScript with Node's type stripping, so it only uses erasable syntax (`.agents/scripts/tsconfig.json` enforces this). `npm run type-check` covers it.
- Tests run in `npm test` and CI. They copy the tools into throwaway git repositories and never touch your checkout. A test helper clears the variables git exports to hooks, since `npm test` itself runs inside `pre-push`.

## Releases

semantic-release publishes from `main` on every merge. The squash-merged PR title decides whether anything ships: `feat:` and `fix:` release, `chore:`, `ci:`, `docs:`, `test:` and `refactor:` do not. Changes to the agent tooling use `chore:` or `ci:`, so they never publish a new version. No path filter is needed.

## What fails open

- No node on `PATH` in a GUI client: the hooks skip lint, the type check and the tests, with a message. The branch rule still applies.
- `git commit --no-verify`: every local hook is skipped. CI and branch protection still apply.
