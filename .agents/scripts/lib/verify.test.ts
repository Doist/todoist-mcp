import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readVerified, stateDir, writeVerified } from './state.ts'
import { createTempRepo, type TempRepo } from './test-repo.ts'
import { codeFingerprint, snapshot } from './tree.ts'
import { runVerify, type Step } from './verify.ts'

// runVerify with stand-in steps (shell one-liners) in a throwaway repo. The real steps are
// covered by steps.test.ts and by running `npm run verify` itself.
let repo: TempRepo
let base: string
let lines: string[]

const pass = (name: string, extra: Partial<Step> = {}): Step => ({
    name,
    command: 'sh',
    args: ['-c', `echo ${name} ok`],
    ...extra,
})
const fail = (name: string): Step => ({
    name,
    command: 'sh',
    args: ['-c', 'for i in $(seq 1 40); do echo "line $i"; done; exit 3'],
})

const verify = (steps: Step[], options: { base?: string | null } = {}) =>
    runVerify({
        root: repo.dir,
        steps,
        base: options.base === null ? undefined : (options.base ?? base),
        out: (line) => lines.push(line),
    })

beforeEach(() => {
    repo = createTempRepo()
    repo.write('.gitignore', '.tmp/\n')
    repo.write('src/a.ts', 'export const a = 1\n')
    repo.write('README.md', 'readme\n')
    repo.git(['add', '.'])
    repo.git(['commit', '--quiet', '-m', 'initial'])
    base = repo.git(['rev-parse', 'HEAD']).stdout.trim()
    repo.git(['switch', '--quiet', '-c', 'feature'])
    lines = []
})

afterEach(() => repo.cleanup())

describe('a code change', () => {
    beforeEach(() => repo.write('src/a.ts', 'export const a = 2\n'))

    it('records the fingerprint of the exact tree it verified', async () => {
        const result = await verify([pass('lint'), pass('tests')])
        expect(result).toEqual({ ok: true, recorded: true })
        expect(readVerified(repo.dir)?.fingerprint).toBe(codeFingerprint(snapshot(repo.dir)))
        expect(lines.some((line) => /^✓ lint \(\d+\.\ds\)$/.test(line))).toBe(true)
    })

    it('records nothing when a step fails, and forgets an earlier pass', async () => {
        writeVerified(repo.dir, { fingerprint: 'earlier', head: 'x', at: 'then' })
        const result = await verify([pass('lint'), fail('tests')])
        expect(result).toEqual({ ok: false, recorded: false })
        expect(readVerified(repo.dir)).toBeUndefined()
    })

    it('prints one line per step, and on failure the log tail and its path', async () => {
        await verify([pass('lint'), fail('tests')])
        const failure = lines.findIndex((line) => line.startsWith('✗ tests (exit 3'))
        expect(failure).toBeGreaterThan(-1)
        expect(lines.slice(failure + 1, failure + 31)).toEqual(
            Array.from({ length: 30 }, (_, i) => `    line ${i + 11}`),
        )
        const logPath = join(stateDir(repo.dir), 'logs/tests.log')
        expect(lines[failure + 31]).toContain('full log: ')
        expect(lines[failure + 31]).toContain('tests.log')
        expect(readFileSync(logPath, 'utf8')).toContain('line 1\n')
    })

    it('runs a dependent step only after its dependency passed', async () => {
        await verify([fail('build'), pass('schemas', { after: 'build' })])
        expect(lines).toContain('- schemas skipped: build failed')
        expect(readVerified(repo.dir)).toBeUndefined()
    })

    it('fails when a command cannot start', async () => {
        const result = await verify([{ name: 'lint', command: 'no-such-command-xyz', args: [] }])
        expect(result.ok).toBe(false)
        expect(lines[0]).toMatch(/^✗ lint \(spawn no-such-command-xyz ENOENT/)
    })

    it('records nothing when files change during the run', async () => {
        const editor = pass('tests', { args: ['-c', 'echo edited > src/b.ts'] })
        const result = await verify([pass('lint'), editor])
        expect(result).toEqual({ ok: false, recorded: false })
        expect(lines.at(-1)).toContain('Files changed during the run: src/b.ts')
        expect(readVerified(repo.dir)).toBeUndefined()
    })

    it('keeps an earlier pass when only files CI alone reads changed', async () => {
        repo.write('src/a.ts', 'export const a = 2\n')
        await verify([pass('lint')])
        const earlier = readVerified(repo.dir)
        repo.git(['add', '.'])
        repo.git(['commit', '--quiet', '-m', 'code'])
        repo.write('.github/workflows/release.yml', 'on: push\n')
        lines = []
        await runVerify({
            root: repo.dir,
            steps: [pass('lint')],
            base: repo.git(['rev-parse', 'HEAD']).stdout.trim(),
            out: (line) => lines.push(line),
        })
        expect(readVerified(repo.dir)).toEqual(earlier)
        expect(readVerified(repo.dir)?.fingerprint).toBe(codeFingerprint(snapshot(repo.dir)))
    })

    it('keeps the pass when only a file CI alone reads changes during the run', async () => {
        const editor = pass('tests', {
            args: ['-c', 'mkdir -p .github/workflows && echo x > .github/workflows/release.yml'],
        })
        const result = await verify([pass('lint'), editor])
        expect(result).toEqual({ ok: true, recorded: true })
        expect(readVerified(repo.dir)?.fingerprint).toBe(codeFingerprint(snapshot(repo.dir)))
    })

    it('keeps its logs and state out of the fingerprint', async () => {
        await verify([pass('lint')])
        expect(existsSync(join(stateDir(repo.dir), 'logs/lint.log'))).toBe(true)
        expect(readVerified(repo.dir)?.fingerprint).toBe(codeFingerprint(snapshot(repo.dir)))
    })
})

describe('what counts as a change', () => {
    it('sees an untracked file as a change', async () => {
        repo.write('src/new.ts', 'new\n')
        expect(await verify([pass('lint')])).toEqual({ ok: true, recorded: true })
        expect(lines[0]).toMatch(/^✓ lint/)
    })

    it('sees committed changes on the branch', async () => {
        repo.write('src/a.ts', 'committed\n')
        repo.git(['commit', '--quiet', '-am', 'change'])
        expect(await verify([pass('lint')])).toEqual({ ok: true, recorded: true })
        expect(lines[0]).toMatch(/^✓ lint/)
    })

    it('keeps an earlier pass when only docs changed', async () => {
        writeVerified(repo.dir, { fingerprint: 'earlier', head: 'x', at: 'then' })
        repo.write('README.md', 'changed\n')
        await verify([pass('lint')])
        expect(readVerified(repo.dir)?.fingerprint).toBe('earlier')
    })

    it('runs the checks when ci.yml changes, since a local test reads it', async () => {
        repo.write('.github/workflows/ci.yml', 'on: push\n')
        expect(await verify([pass('lint')])).toEqual({ ok: true, recorded: true })
    })

    it('has nothing to check for a docs-only change', async () => {
        repo.write('README.md', 'changed\n')
        const result = await verify([fail('lint')])
        expect(result).toEqual({ ok: true, recorded: false })
        expect(lines).toEqual(['Only docs changed since main: nothing to check. Nothing recorded.'])
    })

    it('records nothing when only files CI alone reads changed', async () => {
        repo.write('.github/workflows/release.yml', 'on: push\n')
        repo.write('README.md', 'changed\n')
        const result = await verify([pass('lint')])
        expect(result).toEqual({ ok: true, recorded: false })
        expect(lines[0]).toContain('.github/workflows/release.yml')
        expect(readVerified(repo.dir)).toBeUndefined()
    })

    it('checks everything when a workflow changes along with code', async () => {
        repo.write('.github/workflows/ci.yml', 'on: push\n')
        repo.write('src/a.ts', 'changed\n')
        expect(await verify([pass('lint')])).toEqual({ ok: true, recorded: true })
    })

    it('checks the whole tree, and says so, without a default branch', async () => {
        repo.write('README.md', 'changed\n')
        const result = await verify([pass('lint')], { base: null })
        expect(result).toEqual({ ok: true, recorded: true })
        expect(lines[0]).toBe('No main branch found, so checking the whole tree.')
    })

    it('checks the tree when nothing changed', async () => {
        const result = await verify([pass('lint')])
        expect(result).toEqual({ ok: true, recorded: true })
        expect(lines[0]).toBe('No changes since main; checking the tree anyway.')
    })
})
