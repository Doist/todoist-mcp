import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempRepo, REPO_ROOT, type TempRepo } from './lib/test-repo.ts'

// Runs the exact hook commands from each agent's config, the way the agent would, in a
// throwaway repo with a copy of tools/agents.
type HookConfig = { hooks: Record<string, { hooks: { command: string }[] }[]> }

const AGENTS = [
    {
        name: 'Claude Code',
        config: '.claude/settings.json',
        env: (dir: string) => ({ CLAUDE_PROJECT_DIR: dir }),
    },
    { name: 'Codex', config: '.codex/hooks.json', env: () => ({}) },
    // Cursor runs the Claude Code hooks. If it does not set CLAUDE_PROJECT_DIR, the command falls
    // back to the git root.
    {
        name: 'Cursor (Claude Code hooks, no CLAUDE_PROJECT_DIR)',
        config: '.claude/settings.json',
        env: () => ({ CLAUDE_PROJECT_DIR: undefined }),
    },
]

function command(config: string, event: string): string {
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, config), 'utf8')) as HookConfig
    const commands = parsed.hooks[event]?.flatMap((entry) =>
        entry.hooks.map((hook) => hook.command),
    )
    expect(commands, `${config} ${event}`).toHaveLength(1)
    return commands?.[0] ?? ''
}

let repo: TempRepo

beforeEach(() => {
    repo = createTempRepo()
    repo.copyFromCheckout('.agents/scripts/guard.ts', '.agents/scripts/lib')
    repo.write('.gitignore', '.tmp/\n')
    repo.write('src/a.ts', 'export const a = 1\n')
    repo.git(['add', '.'])
    repo.git(['commit', '--quiet', '-m', 'initial'])
})

afterEach(() => repo.cleanup())

describe.each(AGENTS)('$name', ({ config, env }) => {
    const run = (event: string) =>
        repo.run('sh', ['-c', command(config, event)], {
            cwd: join(repo.dir, 'src'),
            env: env(repo.dir),
            input: JSON.stringify({ session_id: 'wiring' }),
        })

    it('sends the agent back after an unverified code change', () => {
        expect(run('UserPromptSubmit').status).toBe(0)
        repo.write('src/a.ts', 'export const a = 2\n')
        const stop = run('Stop')
        expect(stop.status).toBe(0)
        expect(JSON.parse(stop.stdout)).toMatchObject({ decision: 'block' })
    })

    it('says so, and lets work continue, in a checkout without the guard', () => {
        rmSync(join(repo.dir, '.agents'), { recursive: true })
        const stop = run('Stop')
        expect(stop.status).toBe(0)
        expect(JSON.parse(stop.stdout).systemMessage).toContain('has no .agents/scripts/guard.ts')
    })
})

it('has no Cursor hooks file: Cursor runs the Claude Code hooks, and a second file runs them twice', () => {
    expect(existsSync(join(REPO_ROOT, '.cursor/hooks.json'))).toBe(false)
})
