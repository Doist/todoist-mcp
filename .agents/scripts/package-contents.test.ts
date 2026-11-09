import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { isolatedEnv, REPO_ROOT } from './lib/test-repo.ts'

// Development-only paths, never published: the agent tooling in `.agents/` and the agents'
// own folders, and `scripts/`, the repo's developer scripts. Those import from `src/`, which
// doesn't ship, and need dev dependencies, so they could not run from an installed package; they
// would only put code that reads credentials into every consumer's node_modules.
const DEV_ONLY = ['.agents/', '.claude/', '.codex/', '.cursor/', '.tmp/', 'scripts/']

it('keeps development-only code out of the published package', () => {
    expect(existsSync(join(REPO_ROOT, '.agents/scripts'))).toBe(true)

    const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: REPO_ROOT,
        env: isolatedEnv(),
        encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    const [pack] = JSON.parse(result.stdout) as [{ files: { path: string }[] }]
    const paths = pack.files.map((file) => file.path)

    expect(paths).toContain('package.json')
    expect(paths.filter((path) => DEV_ONLY.some((prefix) => path.startsWith(prefix)))).toEqual([])
})
