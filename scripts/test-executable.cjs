#!/usr/bin/env node

const { spawn } = require('node:child_process')
const path = require('node:path')

console.log('Testing MCP server executable...')

const mainJs = path.join(__dirname, '..', 'dist', 'main.js')
const child = spawn('node', [mainJs], {
    stdio: ['pipe', 'pipe', 'pipe'],
})

let _stdoutOutput = ''
let stderrOutput = ''
let hasError = false

child.stdout.on('data', (data) => {
    _stdoutOutput += data.toString()
})

child.stderr.on('data', (data) => {
    const output = data.toString()
    stderrOutput += output

    // Only consider it an error if it's not related to graceful shutdown
    if (output.includes('Error:') && !output.includes('SIGTERM') && !output.includes('SIGKILL')) {
        console.error('Server startup error detected:', output)
        hasError = true
    }
})

child.on('error', (error) => {
    console.error('Failed to start MCP server:', error.message)
    hasError = true
    process.exit(1)
})

child.on('exit', (code, signal) => {
    // Expected signals when we kill the process
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        return // This is expected
    }

    // Unexpected exit codes during startup
    if (code !== null && code !== 0) {
        console.error(`Server exited unexpectedly with code ${code}`)
        hasError = true
    }
})

// Kill the process after 2 seconds (MCP server should start successfully)
setTimeout(() => {
    if (hasError) {
        console.error('❌ MCP server failed to start properly')
        if (stderrOutput.trim()) {
            console.error('Error output:', stderrOutput.trim())
        }
        process.exit(1)
    }

    // Gracefully terminate
    child.kill('SIGTERM')

    setTimeout(() => {
        console.log('✅ MCP server executable test passed')
        console.log('Server started successfully and is ready to accept connections')
        process.exit(0)
    }, 200) // Give it a moment to clean up
}, 2000)
