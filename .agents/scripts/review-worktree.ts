// `npm run review:worktree -- <dir>`: a separate worktree with the current change in it, for a
// reviewer that needs to run or break code. The shared checkout stays read-only for reviewers.
// See lib/review-worktree.ts.

import { resolve } from 'node:path'
import { CHECKOUT_ROOT } from './lib/git.ts'
import { createReviewWorktree } from './lib/review-worktree.ts'

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
const quoted = `'${dir.replaceAll("'", "'\\''")}'`
console.log(`Review worktree ready: ${dir}`)
console.log(`Install dependencies there before running anything: cd ${quoted} && npm ci`)
console.log(`Remove it when done: git worktree remove --force ${quoted}`)
