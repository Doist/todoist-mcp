// `npm run review:worktree -- <dir>`: a separate worktree with the current change in it, for a
// reviewer that needs to run or break code. The shared checkout stays read-only for reviewers.
//
// It checks out HEAD, applies the staged and unstaged diff, and copies untracked files that are
// not ignored. It does not link node_modules: run `npm ci` there (reinstalling through a
// symlinked node_modules would empty this checkout's install).

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { CHECKOUT_ROOT, cleanGitEnv, git } from './lib/git.ts'

export function createReviewWorktree(root: string, target: string): void {
    if (existsSync(target)) throw new Error(`${target} already exists`)

    const added = git(root, ['worktree', 'add', '--quiet', '--detach', target, 'HEAD'])
    if (!added.ok) throw new Error(`git worktree add failed: ${added.stderr.trim()}`)

    const diff = git(root, ['diff', 'HEAD', '--binary'])
    if (!diff.ok) throw new Error(`git diff failed: ${diff.stderr.trim()}`)
    if (diff.stdout) {
        const applied = spawnSync('git', ['apply', '--whitespace=nowarn'], {
            cwd: target,
            env: cleanGitEnv(),
            input: diff.stdout,
            encoding: 'utf8',
        })
        if (applied.status !== 0) throw new Error(`git apply failed: ${applied.stderr.trim()}`)
    }

    const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
    for (const path of untracked.stdout.split('\0').filter(Boolean)) {
        mkdirSync(dirname(join(target, path)), { recursive: true })
        cpSync(join(root, path), join(target, path), { recursive: true })
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const target = process.argv[2]
    if (!target) {
        console.error('usage: npm run review:worktree -- <dir>')
        process.exit(2)
    }
    const dir = resolve(target)
    try {
        createReviewWorktree(CHECKOUT_ROOT, dir)
    } catch (error) {
        console.error(`review-worktree: ${(error as Error).message}`)
        process.exit(1)
    }
    console.log(`Review worktree ready: ${dir}`)
    console.log(`Install dependencies there before running anything: cd ${dir} && npm ci`)
    console.log(`Remove it when done: git worktree remove --force ${dir}`)
}
