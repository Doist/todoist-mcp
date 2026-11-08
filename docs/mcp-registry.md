# MCP Registry listing

[`server.json`](../server.json) describes the hosted Todoist server in the [Official MCP Registry](https://registry.modelcontextprotocol.io/). Keep its existing name, `net.todoist/mcp`, so clients and directories continue to resolve the same listing.

The endpoint uses OAuth. Clients discover authentication from the server; the manifest does not ask users to supply an API key or an `Authorization` header.

## Publish a metadata update

1. Check the [current entry](https://registry.modelcontextprotocol.io/v0.1/servers?search=net.todoist). Published versions are immutable: choose an unused version higher than the current latest. The version here tracks this hosted listing, independently of the npm package.
2. Review `server.json` against the [registry schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
3. Install the official [`mcp-publisher`](https://modelcontextprotocol.io/registry/quickstart) and authenticate using the existing `todoist.net` domain credentials. Follow the [DNS or HTTP authentication guide](https://modelcontextprotocol.io/registry/authentication); GitHub authentication cannot publish the `net.todoist` namespace.
4. From the repository root, publish the reviewed manifest:

    ```sh
    mcp-publisher publish server.json
    ```

5. Check the current entry again and confirm the new version is active, marked latest, and still points to `https://ai.todoist.net/mcp` with `streamable-http` transport.

Merging this file does not publish it. This manifest covers the hosted service only; it does not change npm releases or deploy the server.
