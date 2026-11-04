import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTempRepo, installHusky, type TempRepo } from './lib/test-repo.ts'

// The real hooks and guard, installed through husky in a throwaway repo. `npx` and `npm`
// are stubs that log their arguments, so the tests see whether lint and tests would run.
// One repo serves every test (macOS scans each new executable on first run, which makes a
// fresh repo per test slow); `beforeEach` puts it back on main at the initial commit.
let repo: TempRepo
let initial: string
let path: string
let pathWithoutNpx: string

beforeAll(() => {
    repo = createTempRepo()
    repo.copyFromCheckout('.husky/pre-commit', '.husky/pre-push', '.agents/scripts/branch-guard.sh')
    repo.write('README.md', 'hello\n')
    expect(repo.git(['add', '.']).status).toBe(0)
    expect(repo.git(['commit', '--quiet', '-m', 'initial']).status).toBe(0)
    initial = repo.git(['rev-parse', 'HEAD']).stdout.trim()

    const remote = join(repo.dir, '.stubs/remote.git')
    expect(repo.git(['init', '--quiet', '--bare', remote]).status).toBe(0)
    repo.git(['remote', 'add', 'origin', remote])
    expect(repo.git(['push', '--quiet', 'origin', 'main']).status).toBe(0)
    repo.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])

    installHusky(repo)

    const gitPath = repo.run('sh', ['-c', 'command -v git']).stdout.trim()
    const bin = join(repo.dir, '.stubs/bin')
    const binWithoutNpx = join(repo.dir, '.stubs/bin-no-npx')
    for (const [dir, tools] of [
        [bin, ['npx', 'npm']],
        [binWithoutNpx, []],
    ] as const) {
        mkdirSync(dir, { recursive: true })
        symlinkSync(gitPath, join(dir, 'git'))
        for (const tool of tools) {
            const stub = `#!/bin/sh\necho "${tool} $*" >> "${repo.dir}/.stubs/calls.log"\n`
            writeFileSync(join(dir, tool), stub, { mode: 0o755 })
        }
    }
    repo.write('.git/info/exclude', '.stubs/\n')
    path = `${bin}:/usr/bin:/bin`
    pathWithoutNpx = `${binWithoutNpx}:/usr/bin:/bin`
})

afterAll(() => repo.cleanup())

beforeEach(() => {
    repo.git(['switch', '--quiet', '--force', '-C', 'main', initial])
    repo.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
    for (const branch of ['feature', 'trunk']) repo.git(['branch', '--quiet', '-D', branch])
    rmSync(join(repo.dir, '.stubs/calls.log'), { force: true })
})

function calls(): string {
    const log = join(repo.dir, '.stubs/calls.log')
    return existsSync(log) ? readFileSync(log, 'utf8') : ''
}

function commit(env: Record<string, string | undefined> = {}) {
    repo.write('file.txt', `${Math.random()}\n`)
    repo.git(['add', 'file.txt'])
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
        expect(result.stderr).toContain("commits on 'main' are not allowed")
        expect(commitsOnHead()).toBe('1')
        expect(calls()).toBe('')
    })

    it('refuses an empty commit on main', () => {
        const result = repo.git(['commit', '--allow-empty', '--quiet', '-m', 'empty'], {
            env: { PATH: path },
        })
        expect(result.status).not.toBe(0)
        expect(commitsOnHead()).toBe('1')
    })

    it('allows a commit on a branch and runs lint-staged', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        const result = commit()
        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
        expect(commitsOnHead()).toBe('2')
        expect(calls()).toBe('npx lint-staged\n')
    })

    it('allows a commit on a detached HEAD', () => {
        repo.git(['switch', '--quiet', '--detach'])
        expect(commit().status).toBe(0)
    })

    it('lets the release workflow commit on main', () => {
        expect(commit({ GITHUB_ACTIONS: 'true' }).status).toBe(0)
        expect(commitsOnHead()).toBe('2')
    })

    it('commits without lint, and says so, when npx is missing', () => {
        repo.git(['switch', '--quiet', '-c', 'feature'])
        const result = commit({ PATH: pathWithoutNpx })
        expect(result.status).toBe(0)
        expect(result.stderr).toContain('npx not found, so lint-staged was skipped')
        expect(commitsOnHead()).toBe('2')
    })

    it('takes the default branch from origin/HEAD', () => {
        repo.git(['update-ref', 'refs/remotes/origin/trunk', 'HEAD'])
        repo.git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
        expect(commit().status).toBe(0)

        repo.git(['switch', '--quiet', '-c', 'trunk'])
        const result = commit()
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain("commits on 'trunk' are not allowed")
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
        expect(result.stderr).toContain("pushes to 'main' are not allowed")
        expect(calls()).toBe('')
    })

    it('refuses a push that includes main among other branches', () => {
        expect(push(['--dry-run', 'origin', 'feature', 'HEAD:main']).status).not.toBe(0)
    })

    it('pushes a branch after type-check and tests', () => {
        const result = push(['--quiet', 'origin', 'feature'])
        expect(result.status).toBe(0)
        expect(calls()).toBe('npm run type-check\nnpm test\n')
    })

    it('lets the release workflow push to main', () => {
        expect(push(['--dry-run', 'origin', 'HEAD:main'], { GITHUB_ACTIONS: 'true' }).status).toBe(
            0,
        )
    })
})
