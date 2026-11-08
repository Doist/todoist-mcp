#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

const [version, manifestPath] = process.argv.slice(2)

if (!version) {
    console.error('Usage: bump-plugin-version.mjs <version> [manifestPath]')
    process.exit(1)
}

const paths = manifestPath
    ? [manifestPath]
    : [
          '.claude-plugin/plugin.json',
          'plugins/todoist/.claude-plugin/plugin.json',
          'gemini-extension.json',
      ]

for (const path of paths) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.version = version
    writeFileSync(path, `${JSON.stringify(manifest, null, 4)}\n`)
    console.log(`Updated ${path} to ${version}`)
}
