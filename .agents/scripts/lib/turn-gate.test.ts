import { existsSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeVerified } from './state.ts'
import { createTempRepo, type TempRepo } from './test-repo.ts'
import { codeFingerprint, snapshot } from './tree.ts'
import { endTurn, startTurn } from './turn-gate.ts'

let repo: TempRepo
const session = 'session-1'

const start = () => startTurn({ root: repo.dir, sessionId: session })
const end = () => endTurn({ root: repo.dir, sessionId: session })
const markVerified = () =>
    writeVerified(repo.dir, {
        fingerprint: codeFingerprint(snapshot(repo.dir)),
        head: 'x',
        at: 'now',
    })

beforeEach(() => {
    repo = createTempRepo()
    repo.write('.gitignore', '.tmp/\n')
    repo.write('src/a.ts', 'export const a = 1\n')
    repo.write('README.md', 'readme\n')
    repo.git(['add', '.'])
    repo.git(['commit', '--quiet', '-m', 'initial'])
})

afterEach(() => repo.cleanup())

describe('turns that pass', () => {
    it('lets a turn that changed nothing end', () => {
        start()
        expect(end()).toEqual({ decision: 'allow' })
    })

    it('lets a docs-only turn end without a reminder', () => {
        start()
        repo.write('README.md', 'changed\n')
        repo.write('docs/new.md', 'new\n')
        expect(end()).toEqual({ decision: 'allow' })
    })

    it('lets a turn that undid its edits end', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        repo.write('src/a.ts', 'export const a = 1\n')
        repo.write('src/tmp.ts', 'scratch\n')
        rmSync(join(repo.dir, 'src/tmp.ts'))
        expect(end()).toEqual({ decision: 'allow' })
    })

    it('lets a turn end when verify passed on the exact tree', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        markVerified()
        expect(end()).toEqual({ decision: 'allow' })
    })

    it('keeps the pass when only docs changed after verify', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        markVerified()
        repo.write('README.md', 'changed after verify\n')
        expect(end()).toEqual({ decision: 'allow' })
    })

    it('notes a change only CI checks, without sending the agent back', () => {
        start()
        repo.write('.github/workflows/release.yml', 'on: push\n')
        const verdict = end()
        expect(verdict.decision).toBe('allow')
        expect(verdict).toHaveProperty('note', expect.stringContaining('only CI checks'))
    })
})

describe('turns that changed code without verifying', () => {
    it('sends the agent back once, naming the files and what to do', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        const verdict = end()
        expect(verdict.decision).toBe('block')
        expect(verdict).toHaveProperty('reason', expect.stringContaining('src/a.ts'))
        expect(verdict).toHaveProperty('reason', expect.stringContaining('npm run verify'))
    })

    it('lets the agent stop the second time, with a note for the person', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        expect(end().decision).toBe('block')
        const second = end()
        expect(second.decision).toBe('allow')
        expect(second).toHaveProperty('note', expect.stringContaining('src/a.ts'))
    })

    it('sends the agent back again in the next turn', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        end()
        end()
        start()
        repo.write('src/a.ts', 'export const a = 3\n')
        expect(end().decision).toBe('block')
    })

    it('catches an edit that keeps the file size', () => {
        start()
        repo.write('src/a.ts', 'export const a = 9\n')
        expect(end().decision).toBe('block')
    })

    it('catches a new untracked file', () => {
        start()
        repo.write('src/new.ts', 'new\n')
        expect(end().decision).toBe('block')
    })

    it('catches code changed after verify passed', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        markVerified()
        repo.write('src/a.ts', 'export const a = 3\n')
        expect(end().decision).toBe('block')
    })

    it('checks each session against the tree it saw at its own turn start', () => {
        start()
        startTurn({ root: repo.dir, sessionId: 'other' })
        repo.write('src/a.ts', 'export const a = 2\n')
        expect(end().decision).toBe('block')
        expect(endTurn({ root: repo.dir, sessionId: 'other' }).decision).toBe('block')
    })
})

describe('a branch', () => {
    beforeEach(() => repo.git(['switch', '--quiet', '-c', 'feature']))

    it('lets the turn end when the code is back to what main has', () => {
        repo.write('src/a.ts', 'export const a = 2\n')
        repo.git(['commit', '--quiet', '-am', 'change'])
        start()
        repo.git(['revert', '--no-edit', '--quiet', 'HEAD'])
        repo.write('docs/note.md', 'note\n')
        expect(end()).toEqual({ decision: 'allow' })
    })

    it('still sends the agent back when the branch differs from main', () => {
        start()
        repo.write('src/a.ts', 'export const a = 2\n')
        expect(end().decision).toBe('block')
    })
})

it('removes turn records older than a week when a turn starts', () => {
    startTurn({ root: repo.dir, sessionId: 'old' })
    const old = join(repo.dir, '.tmp/agents/turns/old.json')
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(old, weekAgo, weekAgo)
    start()
    expect(existsSync(old)).toBe(false)
    expect(existsSync(join(repo.dir, `.tmp/agents/turns/${session}.json`))).toBe(true)
})

it('allows the turn, and says why, without a turn-start record', () => {
    const verdict = end()
    expect(verdict.decision).toBe('allow')
    expect(verdict).toHaveProperty('note', expect.stringContaining('no turn-start record'))
})
