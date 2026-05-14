import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

export async function runBin(binName) {
    const pkgJsonPath = require.resolve('@doist/todoist-mcp/package.json')
    const pkg = require(pkgJsonPath)
    const binEntry = pkg.bin?.[binName]
    if (!binEntry) {
        throw new Error(`@doist/todoist-mcp does not declare a "${binName}" bin`)
    }
    const entryPath = resolve(dirname(pkgJsonPath), binEntry)
    await import(pathToFileURL(entryPath).href)
}
