import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTempRepo, type TempRepo } from './lib/test-repo.ts'
import { codeFingerprint, snapshot } from './lib/tree.ts'
import { createReviewWorktree } from './review-worktree.ts'

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
    target = join(repo.dir, '..', `${repo.dir.split('/').at(-1)}-review`)
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
