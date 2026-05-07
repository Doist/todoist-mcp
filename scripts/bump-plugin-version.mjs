#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

const [version, manifestPath = '.claude-plugin/plugin.json'] = process.argv.slice(2)

if (!version) {
    console.error('Usage: bump-plugin-version.mjs <version> [manifestPath]')
    process.exit(1)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.version = version
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`)
console.log(`Updated ${manifestPath} to ${version}`)
