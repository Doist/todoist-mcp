#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
    console.error('Usage: bump-plugin-version.mjs <version>')
    process.exit(1)
}

const path = '.claude-plugin/plugin.json'
const manifest = JSON.parse(readFileSync(path, 'utf8'))
manifest.version = version
writeFileSync(path, `${JSON.stringify(manifest, null, 4)}\n`)
console.log(`Updated ${path} to ${version}`)
