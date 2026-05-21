# Todoist MCP Server

> **Note:** This package was previously named `@doist/todoist-ai`. The old name continues to work as a thin shim that re-exports from `@doist/todoist-mcp`, but new installs should use `@doist/todoist-mcp` directly.

Library for connecting AI agents to Todoist. Includes tools that can be integrated into LLMs,
enabling them to access and modify a Todoist account on the user's behalf.

These tools can be used both through an MCP server, or imported directly in other projects to
integrate them to your own AI conversational interfaces.

## Using tools

### 1. Add this repository as a dependency

```sh
npm install @doist/todoist-mcp
```

### 2. Import the tools and plug them to an AI

Here's an example using [Vercel's AI SDK](https://ai-sdk.dev/docs/ai-sdk-core/generating-text#streamtext).

```js
import { findTasksByDate, addTasks } from '@doist/todoist-mcp'
import { TodoistApi } from '@doist/todoist-sdk'
import { streamText } from 'ai'

// Create Todoist API client
const client = new TodoistApi(process.env.TODOIST_API_KEY)

// Helper to wrap tools with the client
function wrapTool(tool, todoistClient) {
    return {
        ...tool,
        execute(args) {
            return tool.execute(args, todoistClient)
        },
    }
}

const result = streamText({
    model: yourModel,
    system: 'You are a helpful Todoist assistant',
    tools: {
        findTasksByDate: wrapTool(findTasksByDate, client),
        addTasks: wrapTool(addTasks, client),
    },
})
```

## Using as an MCP server

### Quick Start

You can run the MCP server directly with npx:

```bash
npx @doist/todoist-mcp
```

### Setup Guide

The Todoist MCP server is available as a streamable HTTP service for easy integration with various AI clients:

**Primary URL (Streamable HTTP):** `https://ai.todoist.net/mcp`

#### Claude Desktop

1. Open Settings → Connectors → Add custom connector
2. Enter `https://ai.todoist.net/mcp` and complete OAuth authentication

#### Cursor

Create a configuration file:

- **Global:** `~/.cursor/mcp.json`
- **Project-specific:** `.cursor/mcp.json`

```json
{
    "mcpServers": {
        "todoist": {
            "command": "npx",
            "args": ["-y", "mcp-remote", "https://ai.todoist.net/mcp"]
        }
    }
}
```

Then enable the server in Cursor settings if prompted.

#### Claude Code (CLI)

The fastest setup is the official Todoist plugin, which wires up the MCP server for you:

```bash
/plugin marketplace add doist/todoist-mcp
/plugin install todoist@doist
```

OAuth runs in your browser the first time you use a Todoist tool. See [Anthropic's plugin docs](https://code.claude.com/docs/en/plugins-reference) for more.

If you'd rather configure the MCP server manually, run:

```bash
claude mcp add --transport http todoist https://ai.todoist.net/mcp
```

Then launch `claude`, execute `/mcp`, and select the `todoist` MCP server to authenticate.

#### Visual Studio Code

1. Open Command Palette → MCP: Add Server
2. Select HTTP transport and use:

```json
{
    "servers": {
        "todoist": {
            "type": "http",
            "url": "https://ai.todoist.net/mcp"
        }
    }
}
```

#### Kiro

[![Add to Kiro](https://kiro.dev/images/add-to-kiro.svg)](https://kiro.dev/launch/mcp/add?name=todoist&config=%7B%22url%22%3A%22https%3A%2F%2Fai.todoist.net%2Fmcp%22%7D)

Create or edit a configuration file:

- **Global:** `~/.kiro/settings/mcp.json`
- **Project-specific:** `.kiro/settings/mcp.json`

Using the remote URL (recommended):

```json
{
    "mcpServers": {
        "todoist": {
            "url": "https://ai.todoist.net/mcp"
        }
    }
}
```

Or using npx:

```json
{
    "mcpServers": {
        "todoist": {
            "command": "npx",
            "args": ["-y", "mcp-remote", "https://ai.todoist.net/mcp"]
        }
    }
}
```

For more information, see the [Kiro MCP documentation](https://kiro.dev/docs/mcp/).

#### Other MCP Clients

```bash
npx -y mcp-remote https://ai.todoist.net/mcp
```

For more details on setting up and using the MCP server, including creating custom servers, see [docs/mcp-server.md](docs/mcp-server.md).

## Features

A key feature of this project is that tools can be reused, and are not written specifically for use in an MCP server. They can be hooked up as tools to other conversational AI interfaces (e.g. Vercel's AI SDK).

This project is in its early stages. Expect more and/or better tools soon.

Nevertheless, our goal is to provide a small set of tools that enable complete workflows, rather than just atomic actions, striking a balance between flexibility and efficiency for LLMs.

For our design philosophy, guidelines, and development patterns, see [docs/tool-design.md](docs/tool-design.md).

### Available Tools

For a complete list of available tools, see the [src/tools](src/tools) directory.

#### OpenAI MCP Compatibility

This server includes `search` and `fetch` tools that follow the [OpenAI MCP specification](https://platform.openai.com/docs/mcp), enabling seamless integration with OpenAI's MCP protocol. These tools return JSON-encoded results optimized for OpenAI's requirements while maintaining compatibility with the broader MCP ecosystem.

## Dependencies

- MCP server using the official [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk?tab=readme-ov-file#installation)
- Todoist Typescript API client [@doist/todoist-sdk](https://github.com/Doist/todoist-sdk)

## MCP Server Setup

See [docs/mcp-server.md](docs/mcp-server.md) for full instructions on setting up the MCP server.

## Local Development Setup

See [docs/dev-setup.md](docs/dev-setup.md) for full setup instructions and [CONTRIBUTING.md](CONTRIBUTING.md) for contributor workflows and quality checks.

### MCP Apps

This project includes support for **MCP Apps** – interactive UI widgets rendered inline in AI chat interfaces. Widgets provide rich visual representations of tool outputs (e.g., task lists) instead of plain text.

See [docs/mcp-apps.md](docs/mcp-apps.md) for the widget architecture, build pipeline, and development workflow.

### Quick Start

After cloning and setting up the repository:

- `npm start` - Build and run the MCP inspector for testing
- `npm run dev` - Development mode with auto-rebuild and restart
- `npm run tool:list` - List available tools for direct execution
- `npm run tool -- <tool-name> '<json-args>'` - Run a tool directly without MCP

When using `npm run tool`, include `--` before tool arguments so npm forwards them to `scripts/run-tool.ts`.

Example check before write operations:
`npm run tool -- user-info '{}'`
This confirms which Todoist account the current `TODOIST_API_KEY` is connected to.

`run-tool` uses `TODOIST_API_KEY` from your `.env` file (created from `.env.example` by `npm run setup`). Use a test account or a temporary project when running write operations to avoid modifying real data.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development workflow
- Running tools directly with `scripts/run-tool.ts`
- Testing and quality checks
- Commit conventions

## Releasing

This project uses [release-please](https://github.com/googleapis/release-please) to automate version management and package publishing.

### How it works

1. Make your changes using [Conventional Commits](https://www.conventionalcommits.org/):
    - `feat:` for new features (minor version bump)
    - `fix:` for bug fixes (patch version bump)
    - `feat!:` or `fix!:` for breaking changes (major version bump)
    - `docs:` for documentation changes
    - `chore:` for maintenance tasks
    - `ci:` for CI changes

2. When commits are pushed to `main`:
    - Release-please automatically creates/updates a release PR
    - The PR includes version bump and changelog updates
    - Review the PR and merge when ready

3. After merging the release PR:
    - A new GitHub release is automatically created
    - A new tag is created
    - The `publish` workflow is triggered
    - The package is published to npm
