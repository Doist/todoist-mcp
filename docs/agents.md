# Working with coding agents

This repository is set up so coding agents prove their work before they call it done. This page explains the parts, what each one guarantees, and where it stops. It grows as each part lands.

## Layers

1. **Git hooks** run for everyone, people and agents alike, on every commit and push.

## Rules and what holds them

| Rule                                         | Held by                                                              | Certainty                                |
| -------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| No commits on `main`                         | `pre-commit` → `.agents/scripts/branch-guard.sh`                     | Enforced locally; `--no-verify` skips it |
| No pushes to `main`                          | `pre-push` → `branch-guard.sh`; the "Protect default branch" ruleset | Enforced on GitHub                       |
| Committed files are linted and formatted     | `pre-commit` → lint-staged; CI                                       | Enforced in CI                           |
| Type check and tests pass before a push      | `pre-push`; CI                                                       | Enforced in CI                           |
| Agent tooling never ships in the npm package | `.agents/scripts/package-contents.test.ts`                           | Enforced in CI                           |

"Enforced in CI" means a pull request cannot merge without it. A local hook alone is a speed bump: `git commit --no-verify` skips it.

## Git hooks

Husky installs the hooks when you run `npm install` (the `prepare` script). Nothing changes in your git configuration beyond the `core.hooksPath` husky has always set.

- **`pre-commit`** refuses a commit on `main`, then runs lint-staged. If `npx` is not on `PATH` (some GUI git clients), it skips lint-staged, says so, and lets the commit through. CI still lints.
- **`pre-push`** refuses a push to `main`, then runs the type check and the tests. It checks `git push --dry-run` too.
- The default branch is read from `origin/HEAD`, falling back to `main`.

The release workflow commits and pushes to `main` from GitHub Actions, and husky installs the hooks there as well. The guard therefore skips itself when `GITHUB_ACTIONS=true`. That is the one exemption. Branch protection on GitHub is the real enforcement; the hooks only catch mistakes early.

## Where the tooling lives

- `.agents/scripts/` holds scripts and their tests. It is not under `scripts/` because `scripts/` ships in the npm package.
- The tooling runs straight from TypeScript with Node's type stripping, so it only uses erasable syntax (`.agents/scripts/tsconfig.json` enforces this). `npm run type-check` covers it.
- Tests run in `npm test` and CI. They copy the tools into throwaway git repositories and never touch your checkout. A test helper clears the variables git exports to hooks, since `npm test` itself runs inside `pre-push`.

## Releases

semantic-release publishes from `main` on every merge. The squash-merged PR title decides whether anything ships: `feat:` and `fix:` release, `chore:`, `ci:`, `docs:`, `test:` and `refactor:` do not. Changes to the agent tooling use `chore:` or `ci:`, so they never publish a new version. No path filter is needed.

## What fails open

- No `npx` in a GUI client: lint-staged is skipped, with a message.
- `git commit --no-verify`: every local hook is skipped. CI and branch protection still apply.
