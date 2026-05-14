import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

export async function runEntry(entry) {
    const pkgJsonPath = require.resolve('@doist/todoist-mcp/package.json')
    const entryPath = join(dirname(pkgJsonPath), 'dist', entry)
    await import(pathToFileURL(entryPath).href)
}
