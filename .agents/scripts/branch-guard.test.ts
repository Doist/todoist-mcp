import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTempRepo, installLefthook, type RunResult, type TempRepo } from './lib/test-repo.ts'

// The real hooks and guard, installed through lefthook in a throwaway repo. `npx` and `npm`
// are stubs that log their arguments (and fail when STUB_FAIL names the call), so the tests
// see what the hooks would run. PATH holds only the tools the hooks need, so a system-wide
// npx cannot sneak in.
// One repo serves every test (macOS scans each new executable on first run, which makes a
// fresh repo per test slow); `beforeEach` puts it back on main at the initial commit.
let repo: TempRepo
let initial: string
let path: string
let pathWithoutNode: string
let pathLaunchersOnly: string
let remote: string

beforeAll(() => {
    repo = createTempRepo()
    repo.copyFromCheckout('lefthook.yml', '.agents/scripts/branch-guard.sh')
    repo.write('README.md', 'hello\n')
    expect(repo.git(['add', '.']).status).toBe(0)
    expect(repo.git(['commit', '--quiet', '-m', 'initial']).status).toBe(0)
    initial = repo.git(['rev-parse', 'HEAD']).stdout.trim()

    remote = join(repo.dir, '.stubs/remote.git')
    expect(repo.git(['init', '--quiet', '--bare', remote]).status).toBe(0)
    repo.git(['remote', 'add', 'origin', remote])
    expect(repo.git(['push', '--quiet', 'origin', 'main']).status).toBe(0)
    repo.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])

    installLefthook(repo)

    const bin = join(repo.dir, '.stubs/bin')
    const binWithoutNode = join(repo.dir, '.stubs/bin-no-node')
    const binLaunchersOnly = join(repo.dir, '.stubs/bin-launchers-no-node')
    for (const [dir, stubs] of [
        [bin, ['npx', 'npm', 'node']],
        [binWithoutNode, []],
        [binLaunchersOnly, []],
    ] as const) {
        mkdirSync(dir, { recursive: true })
        for (const tool of [
            'git',
            'sh',
            'env',
            'basename',
            'dirname',
            'cat',
            'uname',
            'tr',
            'sed',
        ]) {
            const real = repo.run('sh', ['-c', `command -v ${tool}`]).stdout.trim()
            symlinkSync(real, join(dir, tool))
        }
        for (const tool of stubs) {
            const stub = [
                '#!/bin/sh',
                `echo "${tool} $*" >> "${repo.dir}/.stubs/calls.log"`,
                `[ "\${STUB_FAIL:-}" = "${tool} $*" ] && exit 1`,
                'exit 0',
                '',
            ].join('\n')
            writeFileSync(join(dir, tool), stub, { mode: 0o755 })
        }
    }
    repo.write('.git/info/exclude', '.stubs/\n')
    path = bin
    pathWithoutNode = binWithoutNode
    // npx and npm as installed: node scripts, which fail without node.
    for (const tool of ['npx', 'npm']) {
        writeFileSync(join(binLaunchersOnly, tool), '#!/usr/bin/env node\n', { mode: 0o755 })
    }
    pathLaunchersOnly = binLaunchersOnly
})

afterAll(() => repo.cleanup())

beforeEach(() => {
    repo.git(['switch', '--quiet', '--force', '-C', 'main', initial])
    repo.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
    for (const branch of ['feature', 'trunk']) {
        repo.git(['branch', '--quiet', '-D', branch])
        repo.git(['--git-dir', remote, 'update-ref', '-d', `refs/heads/${branch}`])
    }
    rmSync(join(repo.dir, '.stubs/calls.log'), { force: true })
})

function calls(): string {
    const log = join(repo.dir, '.stubs/calls.log')
    return existsSync(log) ? readFileSync(log, 'utf8') : ''
}

// Lefthook prints its own banner and each job's output; read both streams.
const output = (result: RunResult) => `${result.stdout}${result.stderr}`

let edits = 0
function commit(env: Record<string, string | undefined> = {}) {
    repo.write('src/a.ts', `export const a = ${++edits}\n`)
    repo.git(['add', 'src/a.ts'])
    return repo.git(['commit', '--quiet', '-m', 'change'], { env: { PATH: path, ...env } })
}

function push(args: string[], env: Record<string, string | undefined> = {}) {
    return repo.git(['push', ...args], { env: { PATH: path, ...env } })
}

const commitsOnHead = () => repo.git(['rev-list', '--count', 'HEAD']).stdout.trim()

describe('pre-commit', () => {
    it('refuses a commit on main before running lint', () => {
        const result = commit()
        expect(result.status).not.toBe(0)
        expect(output(result)).toContain("commits on 'main' are not allowed")
        expect(commitsOnHead()).toBe('1')
        expect(calls()).toBe('')
    })

    it('refuses an empty commit on main, which lefthook runs no pre-commit job for', () => {
        const result = repo.git(['commit', '--allow-empty', '--quiet', '-m', 'empty'], {
            env: { PATH: path },
        })
        expect(result.status).not.toBe(0)
        expect(output(result)).toContain("commits on 'main' are not allowed")
        expect(commitsOnHead()).toBe('1')
    })

    it('refuses a commit on main from a linked worktree that never ran npm install', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        const worktree = join(repo.dir, '.stubs/worktree')
        expect(repo.git(['worktree', 'add', '--quiet', worktree, 'main']).status).toBe(0)
        try {
            writeFileSync(join(worktree, 'note.md'), 'note\n')
            repo.run('git', ['add', 'note.md'], { cwd: worktree })
            const result = repo.run('git', ['commit', '--quiet', '-m', 'note'], {
                cwd: worktree,
                env: { PATH: path },
            })
            expect(result.status).not.toBe(0)
            expect(output(result)).toContain("commits on 'main' are not allowed")
        } finally {
            repo.git(['worktree', 'remove', '--force', worktree])
        }
    })

    it('allows a commit on a branch after lint, format and the type check', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        const result = commit()
        expect(result.status).toBe(0)
        expect(commitsOnHead()).toBe('2')
        expect(calls()).toBe(
            'npx oxlint --fix src/a.ts\n' +
                'npx oxfmt --no-error-on-unmatched-pattern src/a.ts\n' +
                'npm run type-check\n',
        )
    })

    it('runs the schema check when a tool file is staged, and not for its test', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        repo.write('src/tools/x.ts', 'x\n')
        repo.write('src/tools/x.test.ts', 'x\n')
        repo.git(['add', 'src/tools'])
        const result = repo.git(['commit', '--quiet', '-m', 'tool'], { env: { PATH: path } })
        expect(result.status).toBe(0)
        expect(calls()).toContain('npx oxlint --fix src/tools/x.test.ts src/tools/x.ts\n')
        expect(calls()).toContain('npm run lint:schemas\n')
        rmSync(join(repo.dir, '.stubs/calls.log'))
        repo.write('src/tools/x.test.ts', 'y\n')
        repo.git(['add', 'src/tools'])
        repo.git(['commit', '--quiet', '-m', 'test only'], { env: { PATH: path } })
        expect(calls()).not.toContain('lint:schemas')
    })

    it('refuses a commit when the type check fails, even though it runs last', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        expect(commit({ STUB_FAIL: 'npm run type-check' }).status).not.toBe(0)
        expect(commitsOnHead()).toBe('1')
    })

    it('refuses a commit when lint fails, without running the rest', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        expect(commit({ STUB_FAIL: `npx oxlint --fix src/a.ts` }).status).not.toBe(0)
        expect(calls()).toBe('npx oxlint --fix src/a.ts\n')
    })

    it('allows a commit on a detached HEAD', () => {
        repo.git(['switch', '--quiet', '--detach'])
        expect(commit().status).toBe(0)
    })

    it('lets the release workflow commit on main', () => {
        expect(commit({ GITHUB_ACTIONS: 'true' }).status).toBe(0)
        expect(commitsOnHead()).toBe('2')
    })

    it('commits without checks, and says so, when node is not on PATH', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        const result = commit({ PATH: pathWithoutNode })
        expect(result.status).toBe(0)
        expect(output(result)).toContain('node not found, so lint, format and the type check')
        expect(commitsOnHead()).toBe('2')
    })

    it('commits without checks when npx is on PATH but node is not', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        const result = commit({ PATH: pathLaunchersOnly })
        expect(result.status).toBe(0)
        expect(output(result)).toContain('node not found')
    })

    it('still refuses a commit on main when node is not on PATH', () => {
        expect(commit({ PATH: pathWithoutNode }).status).not.toBe(0)
        expect(commitsOnHead()).toBe('1')
    })

    it('takes the default branch from origin/HEAD', () => {
        repo.git(['update-ref', 'refs/remotes/origin/trunk', 'HEAD'])
        repo.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
        expect(commit().status).toBe(0)

        repo.git(['switch', '--quiet', '-c', 'trunk'])
        const result = commit()
        expect(result.status).not.toBe(0)
        expect(output(result)).toContain("commits on 'trunk' are not allowed")
    })
})

describe('pre-push', () => {
    beforeEach(() => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        expect(commit().status).toBe(0)
        rmSync(join(repo.dir, '.stubs/calls.log'), { force: true })
    })

    it('refuses a push to main, even a dry run, before running checks', () => {
        const result = push(['--dry-run', 'origin', 'HEAD:main'])
        expect(result.status).not.toBe(0)
        expect(output(result)).toContain("pushes to 'main' are not allowed")
        expect(calls()).toBe('')
    })

    it('refuses a push that includes main among other branches', () => {
        const result = push(['--dry-run', 'origin', 'feature', 'HEAD:main'])
        expect(result.status).not.toBe(0)
        expect(output(result)).toContain("pushes to 'main' are not allowed")
    })

    it('pushes a branch after the tests pass', () => {
        const result = push(['--quiet', 'origin', 'feature'])
        expect(result.status).toBe(0)
        expect(calls()).toBe('npm test\n')
    })

    it('refuses a push when the tests fail', () => {
        expect(push(['--dry-run', 'origin', 'feature']).status).toBe(0)
        const result = push(['--dry-run', 'origin', 'feature'], { STUB_FAIL: 'npm test' })
        expect(result.status).not.toBe(0)
        expect(calls()).toContain('npm test\n')
    })

    it('pushes without tests when npm is on PATH but node is not', () => {
        const result = push(['--dry-run', 'origin', 'feature'], { PATH: pathLaunchersOnly })
        expect(result.status).toBe(0)
        expect(output(result)).toContain('node not found')
    })

    it('pushes without tests, and says so, when node is not on PATH', () => {
        const result = push(['--dry-run', 'origin', 'feature'], { PATH: pathWithoutNode })
        expect(result.status).toBe(0)
        expect(output(result)).toContain('node not found, so the tests were skipped')
    })

    it('lets the release workflow push to main', () => {
        expect(push(['--dry-run', 'origin', 'HEAD:main'], { GITHUB_ACTIONS: 'true' }).status).toBe(
            0,
        )
    })
})

describe('branch-guard.sh', () => {
    it('fails loudly when a hook calls it with an unknown mode', () => {
        const result = repo.run('sh', ['.agents/scripts/branch-guard.sh', 'comit'])
        expect(result.status).toBe(2)
        expect(result.stderr).toContain('misconfigured')
    })
})
