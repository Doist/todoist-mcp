import {
    chmodSync,
    existsSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createReviewWorktree } from './review-worktree.ts'
import { createTempRepo, type TempRepo } from './test-repo.ts'
import { codeFingerprint, snapshot } from './tree.ts'

let repo: TempRepo
let target: string

beforeEach(() => {
    repo = createTempRepo()
    repo.write('.gitignore', 'ignored/\n')
    repo.write('src/a.ts', 'a\n')
    repo.write('src/gone.ts', 'gone\n')
    repo.write('src/staged.ts', 'old\n')
    writeFileSync(join(repo.dir, 'src/image.bin'), Buffer.from([0, 1, 2, 3]))
    repo.git(['add', '.'])
    repo.git(['commit', '--quiet', '-m', 'initial'])
    target = join(repo.dir, '..', `${basename(repo.dir)} review`)
})

afterEach(() => {
    rmSync(target, { recursive: true, force: true })
    repo.cleanup()
})

it('reproduces staged, unstaged, deleted, binary and untracked changes', () => {
    repo.write('src/a.ts', 'unstaged edit\n')
    repo.write('src/staged.ts', 'staged edit\n')
    repo.git(['add', 'src/staged.ts'])
    rmSync(join(repo.dir, 'src/gone.ts'))
    repo.write('src/new/untracked.ts', 'untracked\n')
    writeFileSync(join(repo.dir, 'src/image.bin'), Buffer.from([0, 1, 2, 255]))
    repo.write('ignored/cache.txt', 'ignored\n')
    const before = codeFingerprint(snapshot(repo.dir))

    createReviewWorktree(repo.dir, target)

    expect(codeFingerprint(snapshot(target))).toBe(before)
    expect(readFileSync(join(target, 'src/a.ts'), 'utf8')).toBe('unstaged edit\n')
    expect(existsSync(join(target, 'src/gone.ts'))).toBe(false)
    expect([...readFileSync(join(target, 'src/image.bin'))]).toEqual([0, 1, 2, 255])
    expect(existsSync(join(target, 'ignored/cache.txt'))).toBe(false)
})

it('works when the user has diff.noprefix set', () => {
    repo.git(['config', 'diff.noprefix', 'true'])
    repo.write('src/a.ts', 'unstaged edit\n')
    createReviewWorktree(repo.dir, target)
    expect(readFileSync(join(target, 'src/a.ts'), 'utf8')).toBe('unstaged edit\n')
})

it('copies an untracked relative symlink as a relative symlink', () => {
    symlinkSync('../src/a.ts', join(repo.dir, 'src/link.ts'))
    createReviewWorktree(repo.dir, target)
    expect(readlinkSync(join(target, 'src/link.ts'))).toBe('../src/a.ts')
})

it('leaves the original checkout as it was', () => {
    repo.write('src/a.ts', 'unstaged edit\n')
    repo.write('src/new.ts', 'untracked\n')
    const status = repo.git(['status', '--porcelain']).stdout
    const before = codeFingerprint(snapshot(repo.dir))

    createReviewWorktree(repo.dir, target)
    writeFileSync(join(target, 'src/a.ts'), 'reviewer broke it\n')

    expect(repo.git(['status', '--porcelain']).stdout).toBe(status)
    expect(codeFingerprint(snapshot(repo.dir))).toBe(before)
})

it('refuses a target that already exists', () => {
    expect(() => createReviewWorktree(repo.dir, repo.dir)).toThrow('already exists')
})

// An unreadable file makes the copy fail, after the worktree exists. Root can read it anyway.
it.skipIf(process.getuid?.() === 0)(
    'cleans up when a step after creating the worktree fails',
    () => {
        repo.write('src/a.ts', 'unstaged edit\n')
        repo.write('src/unreadable.ts', 'secret\n')
        chmodSync(join(repo.dir, 'src/unreadable.ts'), 0o000)
        expect(() => createReviewWorktree(repo.dir, target)).toThrow(/EACCES/)
        expect(existsSync(target)).toBe(false)
        expect(repo.git(['worktree', 'list']).stdout.trim().split('\n')).toHaveLength(1)
    },
)

it('works from the command line, in a checkout whose path has a space', () => {
    repo.copyFromCheckout('.agents/scripts/review-worktree.ts', '.agents/scripts/lib')
    repo.git(['add', '.agents'])
    repo.git(['commit', '--quiet', '-m', 'tools'])
    repo.write('src/a.ts', 'unstaged edit\n')
    const result = repo.run(process.execPath, ['.agents/scripts/review-worktree.ts', target])
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Review worktree ready')
    expect(result.stdout).toContain(`cd '${target}' && npm ci`)
    expect(readFileSync(join(target, 'src/a.ts'), 'utf8')).toBe('unstaged edit\n')
})
