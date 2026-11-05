import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cleanGitEnv, git } from './git.ts'
import { clearVerified, stateDir, writeVerified } from './state.ts'
import { changedPaths, changedSince, classify, codeFingerprint, snapshot } from './tree.ts'

export type Step = {
    name: string
    command: string
    args: string[]
    /** Runs only after this step has passed. Steps without one start together. */
    after?: string
    env?: Record<string, string>
}

export type VerifyOptions = {
    root: string
    steps: Step[]
    /** Where the branch left the default branch; undefined when there is no default branch. */
    base: string | undefined
    baseName?: string
    out?: (line: string) => void
}

export type VerifyResult = { ok: boolean; recorded: boolean }

const LOG_TAIL_LINES = 30

export async function runVerify(options: VerifyOptions): Promise<VerifyResult> {
    const { root, steps, base, baseName = 'main', out = console.log } = options

    if (base === undefined) {
        out(`No ${baseName} branch found, so checking the whole tree.`)
    } else {
        const changes = changedSince(root, base)
        const kinds = new Set(changes.map(classify))
        if (changes.length > 0 && !kinds.has('code')) {
            if (kinds.has('unchecked')) {
                const unchecked = changes.filter((path) => classify(path) === 'unchecked')
                out(`No local check reads what changed since ${baseName}: ${unchecked.join(', ')}.`)
                out('CI is the only check for these. Nothing recorded.')
            } else {
                out(`Only docs changed since ${baseName}: nothing to check. Nothing recorded.`)
            }
            return { ok: true, recorded: false }
        }
        if (changes.length === 0) out(`No changes since ${baseName}; checking the tree anyway.`)
    }

    // From here the checks run, so a run that does not end in a pass must not leave an earlier
    // pass behind. (A docs-only run returns above: docs are outside the fingerprint, so an
    // earlier pass is still valid.)
    clearVerified(root)
    const before = snapshot(root)

    const logDir = join(stateDir(root), 'logs')
    mkdirSync(logDir, { recursive: true })
    const passed = await runSteps(root, steps, logDir, out)
    if (!passed) return { ok: false, recorded: false }

    const after = snapshot(root)
    if (codeFingerprint(after) !== codeFingerprint(before)) {
        const changed = changedPaths(before, after).filter((path) => classify(path) === 'code')
        out(`Files changed during the run: ${changed.join(', ')}. Nothing recorded; run it again.`)
        return { ok: false, recorded: false }
    }

    const head = git(root, ['rev-parse', 'HEAD'])
    const fingerprint = codeFingerprint(after)
    writeVerified(root, {
        fingerprint,
        head: head.ok ? head.stdout.trim() : 'none',
        at: new Date().toISOString(),
    })
    out(`Verified. Recorded fingerprint ${fingerprint.slice(0, 12)}.`)
    return { ok: true, recorded: true }
}

async function runSteps(
    root: string,
    steps: Step[],
    logDir: string,
    out: (line: string) => void,
): Promise<boolean> {
    const results = new Map<string, Promise<boolean>>()
    const start = (step: Step): Promise<boolean> => {
        const existing = results.get(step.name)
        if (existing) return existing
        const dependency = step.after ? steps.find((s) => s.name === step.after) : undefined
        if (step.after && !dependency)
            throw new Error(`step ${step.name} runs after unknown ${step.after}`)
        const result = (dependency ? start(dependency) : Promise.resolve(true)).then((ready) => {
            if (ready) return runStep(root, step, logDir, out)
            out(`- ${step.name} skipped: ${step.after} failed`)
            return false
        })
        results.set(step.name, result)
        return result
    }
    const outcomes = await Promise.all(steps.map(start))
    return outcomes.every(Boolean)
}

function runStep(
    root: string,
    step: Step,
    logDir: string,
    out: (line: string) => void,
): Promise<boolean> {
    const logPath = join(logDir, `${step.name.replace(/[^\w.-]/g, '_')}.log`)
    const log = createWriteStream(logPath)
    const startedAt = Date.now()
    return new Promise((resolve) => {
        const child = spawn(step.command, step.args, {
            cwd: root,
            env: { ...cleanGitEnv(), ...step.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        child.stdout.pipe(log, { end: false })
        child.stderr.pipe(log, { end: false })
        let finished = false
        const finish = (code: number | null, error?: Error) => {
            if (finished) return
            finished = true
            if (error) log.write(`\n${error.message}\n`)
            log.end(() => {
                const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
                if (code === 0) {
                    out(`✓ ${step.name} (${seconds}s)`)
                    resolve(true)
                    return
                }
                const lines = readFileSync(logPath, 'utf8').trimEnd().split('\n')
                out(`✗ ${step.name} (${error ? error.message : `exit ${code}`}, ${seconds}s)`)
                for (const line of lines.slice(-LOG_TAIL_LINES)) out(`    ${line}`)
                out(`    full log: ${relative(process.cwd(), logPath) || logPath}`)
                resolve(false)
            })
        }
        child.on('error', (error) => finish(null, error))
        child.on('close', (code) => finish(code))
    })
}
