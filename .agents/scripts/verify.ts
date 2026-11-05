// `npm run verify`: every check CI runs on a pull request, in about ten seconds.
// Records a fingerprint of the tree only when everything passed; the end-of-turn gate reads it.

import { CHECKOUT_ROOT, branchBase, defaultBranchRef } from './lib/git.ts'
import { clearVerified } from './lib/state.ts'
import { BLIND_SPOTS, LOOSENING_ENV, preflight, VERIFY_STEPS } from './lib/steps.ts'
import { runVerify } from './lib/verify.ts'

const root = CHECKOUT_ROOT

const problems = preflight(root)
if (problems.length > 0) {
    clearVerified(root)
    for (const problem of problems) console.log(`✗ ${problem}`)
    process.exit(1)
}

for (const name of LOOSENING_ENV) {
    if (process.env[name] === undefined) continue
    console.log(`Ignoring ${name}: CI does not set it.`)
    delete process.env[name]
}

const ref = defaultBranchRef(root)
const result = await runVerify({
    root,
    steps: VERIFY_STEPS,
    base: ref ? branchBase(root, ref) : undefined,
    baseName: ref?.replace(/^refs\/(remotes|heads)\//, '') ?? 'main',
})

if (result.recorded) {
    console.log('Not covered by these checks:')
    for (const spot of BLIND_SPOTS) console.log(`- ${spot}`)
}
process.exit(result.ok ? 0 : 1)
