// A separate worktree with the current change in it, for a reviewer that needs to run or break
// code. It checks out HEAD, applies the staged and unstaged diff, and copies untracked files that
// are not ignored. It does not link node_modules: reinstalling through a symlinked node_modules
// would empty the original checkout's install.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from './git.ts'

export function createReviewWorktree(root: string, target: string): void {
    if (existsSync(target)) throw new Error(`${target} already exists`)

    const added = git(root, ['worktree', 'add', '--quiet', '--detach', target, 'HEAD'])
    if (!added.ok) throw new Error(`git worktree add failed: ${added.stderr.trim()}`)

    try {
        // Fixed prefixes and no external diff or colour, whatever the user's git config says,
        // so `git apply` can read the patch.
        const diff = git(root, [
            'diff',
            'HEAD',
            '--binary',
            '--no-ext-diff',
            '--no-color',
            '--src-prefix=a/',
            '--dst-prefix=b/',
        ])
        if (!diff.ok) throw new Error(`git diff failed: ${diff.stderr.trim()}`)
        if (diff.stdout) {
            const applied = git(target, ['apply', '--whitespace=nowarn'], { input: diff.stdout })
            if (!applied.ok) throw new Error(`git apply failed: ${applied.stderr.trim()}`)
        }

        const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
        if (!untracked.ok) throw new Error(`git ls-files failed: ${untracked.stderr.trim()}`)
        for (const path of untracked.stdout.split('\0').filter(Boolean)) {
            mkdirSync(dirname(join(target, path)), { recursive: true })
            // verbatimSymlinks keeps a relative link relative, instead of pointing it back into
            // the original checkout.
            cpSync(join(root, path), join(target, path), {
                recursive: true,
                verbatimSymlinks: true,
            })
        }
    } catch (error) {
        // Leave nothing behind, so a retry is not refused with "already exists".
        git(root, ['worktree', 'remove', '--force', target])
        rmSync(target, { recursive: true, force: true })
        throw error
    }
}
