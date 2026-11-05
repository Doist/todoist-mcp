import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { isolatedEnv, REPO_ROOT } from './lib/test-repo.ts'

// Agent tooling is development-only. `scripts/` ships in the npm package, so the tooling
// lives in `.agents/`, and must never be published.
const DEV_ONLY = ['.agents/', '.claude/', '.codex/', '.cursor/', '.tmp/']

it('keeps agent tooling out of the published package', () => {
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
