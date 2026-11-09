# Check: privacy and secrets

This repository is public, and the npm package ships `dist/`.

## Report

- A secret, API key, token or password, even an expired one.
- Real user data in fixtures, snapshots or docs: real names, emails, task content, Todoist IDs copied from an account.
- Internal details: private hostnames, internal URLs, staging servers, Doist-internal tools or documents.
- A new file under `scripts/` or in package.json `files` that should not be published.
- Untracked files the change doesn't need (`.env`, logs, eval output under `tmp/`).

## Fine

- Made-up fixtures (`TEST_IDS`, `example.com`, "Test task").
- Public URLs: `todoist.com`, the public API, GitHub.
- `TODOIST_BASE_URL` documented as an option, without a private value.
