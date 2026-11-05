# Check: evidence

Apply to the PR description and any report from an agent.

## Report

- A behaviour claim ("fixed", "works", "safe", "no regressions") with no test or command that ran it.
- A "Not verified" section missing when something could not be checked: MCP Apps widgets, real API calls, model behaviour.
- A change to shared code (`src/utils/`, `src/tool-helpers.ts`, `src/utils/output-schemas.ts`, `src/index.ts`) without the one fact that makes it safe.
- A PR title whose type doesn't match the change: behaviour changes need `feat:` or `fix:` to release; tooling and docs use `chore:`, `ci:`, `docs:` or `test:` so they don't.

## Fine

- Claims about what the code shows, with the cited line.
