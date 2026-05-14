# @doist/todoist-ai

> **This package has been renamed to [`@doist/todoist-mcp`](https://npmjs.com/package/@doist/todoist-mcp).**

Please update your dependency:

```bash
npm install @doist/todoist-mcp
```

And update your imports:

```ts
import { getMcpServer } from '@doist/todoist-mcp'
```

The CLI entrypoints have been renamed too:

```bash
npx @doist/todoist-mcp           # was: npx @doist/todoist-ai
npx -p @doist/todoist-mcp todoist-mcp-http
```

This package continues to work as a thin shim that re-exports `@doist/todoist-mcp` and forwards the legacy CLI bins (`todoist-ai`, `todoist-ai-http`) to the new package, but it will not receive new features.
