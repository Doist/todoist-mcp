# MCP Server Setup

This document outlines the steps necessary to run this MCP server and connect to an MCP host application, such as Claude Desktop or Cursor.

## Quick Setup

The easiest way to use this MCP server is with npx:

```bash
npx @doist/todoist-mcp
```

You'll need to set your Todoist API key as an environment variable `TODOIST_API_KEY`.

## Local Development Setup

Start by cloning this repository and setting it up locally, if you haven't done so yet.

```sh
git clone https://github.com/Doist/todoist-mcp
npm run setup
```

To test the server locally before connecting it to an MCP client, you can use:

```sh
npm start
```

This will build the project and run the MCP inspector for manual testing.

### Creating a Custom MCP Server

For convenience, we also include a function that initializes an MCP Server with all the tools available:

```js
import { getMcpServer } from '@doist/todoist-mcp'

async function main() {
    const server = getMcpServer({ todoistApiKey: process.env.TODOIST_API_KEY })
    const transport = new StdioServerTransport()
    await server.connect(transport)
}
```

Then, proceed depending on the MCP protocol transport you'll use.

## Using Standard I/O Transport

### Quick Setup with npx

Add this section to your `mcp.json` config in Claude, Cursor, etc.:

```json
{
    "mcpServers": {
        "todoist-mcp": {
            "type": "stdio",
            "command": "npx",
            "args": ["@doist/todoist-mcp"],
            "env": {
                "TODOIST_API_KEY": "your-todoist-token-here"
            }
        }
    }
}
```

### Using local installation

Add this `todoist-mcp-local` section to your `mcp.json` config in Cursor, Claude, Raycast, etc.

```json
{
    "mcpServers": {
        "todoist-mcp-local": {
            "type": "stdio",
            "command": "node",
            "args": ["/Users/<your_user_name>/code/todoist-mcp/dist/main.js"],
            "env": {
                "TODOIST_API_KEY": "your-todoist-token-here"
            }
        }
    }
}
```

Update the configuration above as follows

- Replace `TODOIST_API_KEY` with your Todoist API token.
- Replace the path in the `args` array with the correct path to where you cloned the repository

> [!NOTE]
> You may also need to change the command, passing the full path to your `node` binary, depending one how you installed `node`.

## Using Streamable HTTP Server Transport

You can run the MCP server as a local HTTP service. This is useful as an alternative to the hosted service at `ai.todoist.net/mcp`, especially if you experience frequent session disconnections ([#239](https://github.com/Doist/todoist-mcp/issues/239)).

> [!IMPORTANT]
> The standalone HTTP server runs every MCP tool with the `TODOIST_API_KEY` supplied by the operator. It binds to `127.0.0.1` by default and is intended for local MCP clients. Do not expose it to a LAN or the public internet unless you add your own trusted network and authentication controls.

### Quick Start with npx

```bash
TODOIST_API_KEY=your-key npx -p @doist/todoist-mcp todoist-mcp-http

# Custom port
TODOIST_API_KEY=your-key PORT=8080 npx -p @doist/todoist-mcp todoist-mcp-http

# Explicitly expose on all interfaces. Only do this behind trusted network/auth controls.
TODOIST_API_KEY=your-key HOST=0.0.0.0 npx -p @doist/todoist-mcp todoist-mcp-http
```

### Running from Source

After cloning the repository:

```bash
# Install dependencies and build
npm install && npm run build

# Run the HTTP server
TODOIST_API_KEY=your-key npm run start:http

# Or directly with node
TODOIST_API_KEY=your-key node dist/main-http.js
```

### Environment Variables

| Variable           | Default     | Description                                                                       |
| ------------------ | ----------- | --------------------------------------------------------------------------------- |
| `TODOIST_API_KEY`  | (required)  | Your Todoist API key. MCP tool calls run as this Todoist user.                    |
| `HOST`             | `127.0.0.1` | HTTP bind host. Use non-loopback hosts only behind trusted network/auth controls. |
| `PORT`             | `3000`      | HTTP server port                                                                  |
| `TODOIST_BASE_URL` | (optional)  | Custom Todoist API base URL                                                       |

### Local Development

```sh
PORT=8080 npm run dev:http
```

This will expose the service at `http://127.0.0.1:8080/mcp` with hot-reload.

### Connecting MCP Clients

MCP host applications can connect via the `mcp-remote` bridge:

```json
{
    "mcpServers": {
        "todoist-mcp-http": {
            "type": "stdio",
            "command": "npx",
            "args": ["mcp-remote", "http://localhost:3000/mcp"]
        }
    }
}
```

### Health Check

The HTTP server exposes a health check endpoint at `/health` that returns:

- Server status

```bash
curl http://localhost:3000/health
```

> [!NOTE]
> You may also need to change the command, passing the full path to your `npx` binary, depending on how you installed `node`.

## MCP Apps (task-list) build pipeline

- The task list app is built as a single HTML file in `dist/mcp-apps/index.html`.
- The MCP server reads that HTML at startup, hashes it, and uses a `ui://...@<hash>` URI for cache-busting.
- `npm run build` builds both the server bundle and the MCP Apps HTML.
- `npm run dev` watches both builds and restarts the server when JS or HTML changes.
