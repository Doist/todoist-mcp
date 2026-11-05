import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from './state.ts'
import type { Step } from './verify.ts'

const bin = (tool: string) => `node_modules/.bin/${tool}`

// The same environment CI's test job sets. NODE_ENV=test changes what the server returns
// (src/mcp-helpers.ts), so checks must run with it to match CI.
const CI_ENV = { NODE_ENV: 'test', CI: 'true' }

/** Every check `.github/workflows/ci.yml` runs on a pull request, with one shared build. */
export const VERIFY_STEPS: Step[] = [
    { name: 'lint', command: bin('oxlint'), args: ['src', 'scripts', '.agents/scripts'] },
    { name: 'format', command: bin('oxfmt'), args: ['--check'] },
    { name: 'types', command: bin('tsc'), args: ['--noEmit'] },
    { name: 'types:tools', command: bin('tsc'), args: ['--noEmit', '-p', '.agents/scripts'] },
    { name: 'tests', command: bin('vitest'), args: ['run'], env: CI_ENV },
    { name: 'build', command: 'npm', args: ['run', '--silent', 'build'], env: CI_ENV },
    {
        name: 'schemas',
        command: bin('tsx'),
        args: ['scripts/validate-schemas.ts'],
        after: 'build',
        env: CI_ENV,
    },
    {
        name: 'executable',
        command: 'node',
        args: ['scripts/test-executable.cjs'],
        after: 'build',
        env: { ...CI_ENV, TODOIST_API_KEY: 'fake-api-key-for-testing' },
    },
]

/**
 * How each `run:` in CI's test job maps to verify steps. For `npm run <script>`, the steps must
 * run the script's commands, in order; steps.test.ts compares them with package.json and ci.yml,
 * so CI and verify cannot drift apart silently.
 */
export const CI_EQUIVALENTS: { run: string; steps: string[] }[] = [
    { run: 'npm ci', steps: [] }, // the preflight checks node_modules matches the lockfile
    { run: 'npm run test', steps: ['tests'] },
    { run: 'npm run type-check', steps: ['types', 'types:tools'] },
    { run: 'npm run format:check', steps: ['lint', 'format'] },
    { run: 'npm run lint:schemas', steps: ['build', 'schemas'] },
    { run: 'npm run test:executable', steps: ['build', 'executable'] },
]

/** Variables that loosen a check. CI never sets them, so verify removes them. */
export const LOOSENING_ENV = ['MCP_TOKEN_BUDGET']

type PackageJson = {
    engines?: { node?: string }
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
}
type Lockfile = { packages?: Record<string, { version?: string }> }

/** Problems that would make the checks fail for reasons unrelated to the change. */
export function preflight(root: string, nodeVersion = process.versions.node): string[] {
    const problems: string[] = []
    const pkg = readJson<PackageJson>(join(root, 'package.json'))
    const minimum = pkg?.engines?.node?.match(/^>=\s*(\d+)/)?.[1]
    const major = Number(nodeVersion.split('.')[0])
    if (minimum && major < Number(minimum)) {
        problems.push(
            `Node ${nodeVersion} is older than the ${pkg?.engines?.node} this repository needs. ` +
                'Switch versions (see .nvmrc) and run again.',
        )
    }

    if (!existsSync(join(root, 'node_modules'))) {
        problems.push('node_modules is missing. Run `npm ci`.')
        return problems
    }
    const lock = readJson<Lockfile>(join(root, 'package-lock.json'))
    if (!lock?.packages) {
        problems.push('package-lock.json is missing or unreadable. Run `npm install`.')
        return problems
    }
    const stale: string[] = []
    for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies })) {
        const locked = lock.packages[`node_modules/${name}`]?.version
        if (!locked) {
            stale.push(`${name} is not in the lockfile`)
            continue
        }
        const installed = readJson<{ version?: string }>(
            join(root, 'node_modules', name, 'package.json'),
        )?.version
        if (installed !== locked) {
            stale.push(`${name} ${installed ?? 'missing'} (lockfile: ${locked})`)
        }
    }
    if (stale.length > 0) {
        problems.push(
            `node_modules does not match package-lock.json: ${stale.join(', ')}. Run \`npm ci\`.`,
        )
    }
    return problems
}

/** What verification cannot see, printed after every pass. */
export const BLIND_SPOTS = [
    'the MCP Apps widgets (src/mcp-apps) rendered in a real client',
    'calls against the real Todoist API (use `npm run tool`, on a test account)',
    'how models use tool descriptions and instructions (use `npm run eval`)',
]
