// Throwaway git repositories for testing the agent tooling.
// Tests copy the tools into a temp repo and run them there, never in the real checkout.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CHECKOUT_ROOT, cleanGitEnv } from './git.ts'

export const REPO_ROOT = CHECKOUT_ROOT

/** Environment for a test process: no hook variables, no user git config, no CI exemption. */
export function isolatedEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    // Clears the variables git exports to hooks. Left in place, a git command in a test would
    // act on the real repository: `npm test` runs inside the pre-push hook.
    const env = cleanGitEnv()
    // DISABLE_AGENT_GUARD and LEFTHOOK=0 may be set by the person or agent running the tests; they
    // would turn off what the tests check.
    for (const name of [
        'GITHUB_ACTIONS',
        'LEFTHOOK',
        'LEFTHOOK_BIN',
        'LEFTHOOK_CONFIG',
        'GIT_CONFIG_PARAMETERS',
        'DISABLE_AGENT_GUARD',
    ]) {
        delete env[name]
    }
    Object.assign(env, {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
    })
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete env[key]
        else env[key] = value
    }
    return env
}

export type RunResult = SpawnSyncReturns<string>

export type TempRepo = {
    dir: string
    /** Runs a command in the repo with an isolated environment. */
    run: (
        command: string,
        args: string[],
        options?: { env?: Record<string, string | undefined>; input?: string; cwd?: string },
    ) => RunResult
    git: (args: string[], options?: { env?: Record<string, string | undefined> }) => RunResult
    write: (path: string, content: string) => void
    /** Copies files or folders from the real checkout into the same paths in this repo. */
    copyFromCheckout: (...paths: string[]) => void
    cleanup: () => void
}

export function createTempRepo(): TempRepo {
    const dir = mkdtempSync(join(tmpdir(), 'agent tools-'))

    const run: TempRepo['run'] = (command, args, options = {}) =>
        spawnSync(command, args, {
            cwd: options.cwd ?? dir,
            env: isolatedEnv(options.env),
            input: options.input,
            encoding: 'utf8',
        })

    const repo: TempRepo = {
        dir,
        run,
        git: (args, options) => run('git', args, options),
        write(path, content) {
            mkdirSync(dirname(join(dir, path)), { recursive: true })
            writeFileSync(join(dir, path), content)
        },
        copyFromCheckout(...paths) {
            for (const path of paths) {
                mkdirSync(dirname(join(dir, path)), { recursive: true })
                cpSync(join(REPO_ROOT, path), join(dir, path), { recursive: true })
            }
        },
        cleanup() {
            rmSync(dir, { recursive: true, force: true })
        },
    }

    const init = repo.git(['init', '--quiet', '--initial-branch', 'main'])
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
    // If git variables leaked through, git would be acting on another repository. Stop first.
    const toplevel = repo.git(['rev-parse', '--show-toplevel']).stdout.trim()
    if (realpathSync(toplevel) !== realpathSync(dir)) {
        throw new Error(`git resolves ${dir} to ${toplevel}; refusing to run tests there`)
    }
    return repo
}

/** Installs the repo's lefthook hooks the way `npm install` does, with the checkout's lefthook. */
export function installLefthook(repo: TempRepo): void {
    const lefthook = join(REPO_ROOT, 'node_modules/lefthook/bin/index.js')
    const result = repo.run(process.execPath, [lefthook, 'install', '--reset-hooks-path'])
    if (result.status !== 0) throw new Error(`lefthook install failed: ${result.stderr}`)
}
