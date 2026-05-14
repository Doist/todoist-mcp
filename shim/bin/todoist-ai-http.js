#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkgJsonPath = require.resolve('@doist/todoist-mcp/package.json')
const binPath = join(dirname(pkgJsonPath), 'dist', 'main-http.js')

const child = spawn(process.execPath, [binPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
})
child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
})
