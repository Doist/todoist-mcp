#!/usr/bin/env node

const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const repoRoot = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

const bins = Object.entries(pkg.bin ?? {})
if (bins.length === 0) {
    console.error('❌ No bin entries declared in package.json')
    process.exit(1)
}

async function smokeTestBin(binName, relativePath) {
    const binPath = path.join(repoRoot, relativePath)
    if (!fs.existsSync(binPath)) {
        throw new Error(`bin ${binName} points to missing file ${relativePath}`)
    }

    console.log(`Testing bin "${binName}" → ${relativePath} ...`)

    return new Promise((resolve, reject) => {
        const child = spawn('node', [binPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PORT: '0' },
        })

        let stderrOutput = ''
        let hasError = false

        child.stderr.on('data', (data) => {
            const output = data.toString()
            stderrOutput += output
            if (
                output.includes('Error:') &&
                !output.includes('SIGTERM') &&
                !output.includes('SIGKILL')
            ) {
                console.error(`Server startup error detected (${binName}):`, output)
                hasError = true
            }
        })

        child.on('error', (error) => {
            reject(new Error(`Failed to start bin ${binName}: ${error.message}`))
        })

        child.on('exit', (code, signal) => {
            if (signal === 'SIGTERM' || signal === 'SIGKILL') return
            if (code !== null && code !== 0) {
                hasError = true
                console.error(`bin ${binName} exited unexpectedly with code ${code}`)
            }
        })

        setTimeout(() => {
            if (hasError) {
                if (stderrOutput.trim()) console.error('Error output:', stderrOutput.trim())
                child.kill('SIGTERM')
                return reject(new Error(`bin ${binName} failed to start`))
            }
            child.kill('SIGTERM')
            setTimeout(() => {
                console.log(`✅ bin "${binName}" started successfully`)
                resolve()
            }, 200)
        }, 2000)
    })
}

;(async () => {
    try {
        for (const [name, relativePath] of bins) {
            await smokeTestBin(name, relativePath)
        }
        console.log('✅ All bin entries exercised successfully')
        process.exit(0)
    } catch (error) {
        console.error(`❌ ${error.message}`)
        process.exit(1)
    }
})()
