# Contributing

## Development Setup

For full local setup instructions (dependencies, `.env`, and MCP inspector workflow), see [docs/dev-setup.md](docs/dev-setup.md).

## Run Tools Directly (Without MCP)

Use `scripts/run-tool.ts` to execute tools directly during development.
When using `npm run tool`, include `--` before tool arguments so npm forwards them to `scripts/run-tool.ts`.

`run-tool` authenticates with `TODOIST_API_KEY` from your `.env` file (created from `.env.example` via `npm run setup`).
Use a test account or a temporary project for write operations so you do not modify real Todoist data.
Before running write tools, you can verify which Todoist account is connected:
`npm run tool -- user-info '{}'`

```sh
npm run tool:list
npm run tool -- <tool-name> '<json-args>'
npm run tool -- <tool-name> --file <args.json>
```

Examples:

```sh
npm run tool -- add-tasks '{"tasks":[{"content":"Test task"}]}'
npm run tool -- find-tasks '{"searchText":"meeting"}'
npm run tool -- get-overview '{}'
```

## Quality Checks

Run `npm run verify` before opening a PR. It runs every check CI runs (lint, format, types, tests, build, schema validation, the executable smoke test) in about ten seconds.

## Tool Changes

When adding or changing tool behavior:

1. Update tool schema descriptions in the source file.
2. Update `src/mcp-server.ts` guidance when relevant.
3. Add or update tests covering the change.
4. Include usage examples where helpful.

## Commit Conventions

This repository uses Conventional Commits:

- `feat:` new features
- `fix:` bug fixes
- `feat!:` or `fix!:` breaking changes
- `docs:` documentation
- `chore:` maintenance
- `ci:` CI changes
