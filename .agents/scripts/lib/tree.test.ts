import { rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempRepo, type TempRepo } from './test-repo.ts'
import { changedPaths, changedSince, classify, codeFingerprint, snapshot } from './tree.ts'

let repo: TempRepo

beforeEach(() => {
    repo = createTempRepo()
    repo.write('src/a.ts', 'export const a = 1\n')
    repo.write('README.md', 'readme\n')
    repo.write('.gitignore', 'ignored/\n')
    repo.git(['add', '.'])
    repo.git(['commit', '--quiet', '-m', 'initial'])
})

afterEach(() => repo.cleanup())

const objectCount = () => repo.git(['count-objects', '-v']).stdout

describe('snapshot', () => {
    it('sees an edit that keeps the size and modification time', () => {
        const before = codeFingerprint(snapshot(repo.dir))
        const file = join(repo.dir, 'src/a.ts')
        repo.write('src/a.ts', 'export const a = 2\n')
        utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1))
        const middle = codeFingerprint(snapshot(repo.dir))
        repo.write('src/a.ts', 'export const a = 3\n')
        utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1))
        const after = codeFingerprint(snapshot(repo.dir))
        expect(new Set([before, middle, after]).size).toBe(3)
    })

    it('includes untracked files and leaves out ignored ones', () => {
        const before = snapshot(repo.dir)
        repo.write('src/new.ts', 'new\n')
        repo.write('ignored/build.js', 'built\n')
        expect(changedPaths(before, snapshot(repo.dir))).toEqual(['src/new.ts'])
    })

    it('sees a deleted tracked file', () => {
        const before = snapshot(repo.dir)
        rmSync(join(repo.dir, 'src/a.ts'))
        expect(changedPaths(before, snapshot(repo.dir))).toEqual(['src/a.ts'])
    })

    it('sees an executable bit change', () => {
        const before = codeFingerprint(snapshot(repo.dir))
        repo.run('chmod', ['+x', 'src/a.ts'])
        expect(codeFingerprint(snapshot(repo.dir))).not.toBe(before)
    })

    it('writes nothing to the object store', () => {
        repo.write('src/new.ts', 'new\n')
        const before = objectCount()
        snapshot(repo.dir)
        expect(objectCount()).toBe(before)
    })
})

describe('codeFingerprint', () => {
    it('ignores docs and files only CI reads, and nothing else', () => {
        const before = codeFingerprint(snapshot(repo.dir))
        repo.write('README.md', 'changed\n')
        repo.write('docs/guide.md', 'new\n')
        repo.write('.github/workflows/release.yml', 'on: push\n')
        expect(codeFingerprint(snapshot(repo.dir))).toBe(before)
        repo.write('src/prompt.md', 'markdown the server could load\n')
        expect(codeFingerprint(snapshot(repo.dir))).not.toBe(before)
    })
})

describe('classify', () => {
    it.each([
        ['README.md', 'docs'],
        ['docs/dev-setup.md', 'docs'],
        ['CODEBASE.md', 'code'],
        ['CONTRIBUTING.md', 'docs'],
        ['AGENTS.md', 'code'],
        ['docs/agents.md', 'code'],
        ['.agents/skills/verify/SKILL.md', 'code'],
        ['.github/PULL_REQUEST_TEMPLATE.md', 'docs'],
        ['LICENSE', 'docs'],
        ['.github/workflows/ci.yml', 'code'],
        ['.github/workflows/release.yml', 'unchecked'],
        ['.github/renovate.json', 'unchecked'],
        ['src/mcp-server.ts', 'code'],
        ['src/notes.md', 'code'],
        ['package-lock.json', 'code'],
        ['.agents/scripts/verify.ts', 'code'],
        ['.husky/pre-commit', 'code'],
    ])('%s is %s', (path, kind) => {
        expect(classify(path)).toBe(kind)
    })
})

describe('changedSince', () => {
    it('lists committed, staged, unstaged and untracked changes', () => {
        const base = repo.git(['rev-parse', 'HEAD']).stdout.trim()
        repo.git(['switch', '--quiet', '-c', 'feature'])
        repo.write('src/committed.ts', '1\n')
        repo.git(['add', '.'])
        repo.git(['commit', '--quiet', '-m', 'c'])
        repo.write('src/staged.ts', '1\n')
        repo.git(['add', 'src/staged.ts'])
        repo.write('src/a.ts', 'unstaged\n')
        repo.write('src/untracked.ts', '1\n')
        expect(changedSince(repo.dir, base)).toEqual([
            'src/a.ts',
            'src/committed.ts',
            'src/staged.ts',
            'src/untracked.ts',
        ])
    })
})
