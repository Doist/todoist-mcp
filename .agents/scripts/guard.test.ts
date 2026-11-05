import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createTempRepo, type TempRepo } from './lib/test-repo.ts'

// guard.ts as the agents' hooks run it: a separate node process, the hook's JSON on stdin, in a
// throwaway repo holding a copy of tools/agents.
let repo: TempRepo

function guard(
    event: string,
    payload: Record<string, unknown> = { session_id: 's1' },
    options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
    const result = repo.run(process.execPath, [join(repo.dir, '.agents/scripts/guard.ts'), event], {
        input: JSON.stringify(payload),
        ...options,
    })
    return { ...result, json: result.stdout ? JSON.parse(result.stdout) : undefined }
}

beforeEach(() => {
    repo = createTempRepo()
    repo.copyFromCheckout('.agents/scripts/guard.ts', '.agents/scripts/lib')
    repo.write('.gitignore', '.tmp/\n')
    repo.write('src/a.ts', 'export const a = 1\n')
    repo.git(['add', '.'])
    repo.git(['commit', '--quiet', '-m', 'initial'])
})

afterEach(() => repo.cleanup())

it('prints nothing for a turn that changed nothing', () => {
    expect(guard('turn-start').status).toBe(0)
    const end = guard('turn-end')
    expect(end.status).toBe(0)
    expect(end.stdout).toBe('')
})

it('sends the agent back with the block decision every agent reads', () => {
    guard('turn-start')
    repo.write('src/a.ts', 'export const a = 2\n')
    const end = guard('turn-end')
    expect(end.status).toBe(0)
    expect(end.json).toEqual({ decision: 'block', reason: expect.stringContaining('src/a.ts') })
})

it('sends the agent back on the first stop even if another hook set stop_hook_active or loop_count', () => {
    for (const reentry of [{ stop_hook_active: true }, { loop_count: 1 }]) {
        guard('turn-start')
        repo.write('src/a.ts', `export const a = ${JSON.stringify(reentry)}\n`)
        expect(guard('turn-end', { session_id: 's1', ...reentry }).json?.decision).toBe('block')
        const second = guard('turn-end', { session_id: 's1', ...reentry })
        expect(second.json).toEqual({ systemMessage: expect.stringContaining('agent-guard:') })
    }
})

it('guards the checkout it lives in, whatever the working directory and git variables', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'agent-elsewhere-'))
    try {
        const other = { GIT_DIR: join(elsewhere, '.git'), GIT_WORK_TREE: elsewhere }
        guard('turn-start', { session_id: 's1' }, { cwd: elsewhere, env: other })
        repo.write('src/a.ts', 'export const a = 2\n')
        const end = guard('turn-end', { session_id: 's1' }, { cwd: elsewhere, env: other })
        expect(end.json?.decision).toBe('block')
    } finally {
        rmSync(elsewhere, { recursive: true, force: true })
    }
})

it('uses one default session when the payload has no id', () => {
    guard('turn-start', {})
    repo.write('src/a.ts', 'export const a = 2\n')
    expect(guard('turn-end', {}).json?.decision).toBe('block')
})

it('fails open, visibly, when a library file is broken', () => {
    guard('turn-start')
    repo.write('.agents/scripts/lib/turn-gate.ts', 'this is not valid typescript (\n')
    const end = guard('turn-end')
    expect(end.status).toBe(0)
    expect(end.json).toEqual({
        systemMessage: expect.stringContaining('turn-end hook failed, so it allowed the action'),
    })
})

it('fails open on input that is not JSON', () => {
    const result = repo.run(
        process.execPath,
        [join(repo.dir, '.agents/scripts/guard.ts'), 'turn-end'],
        {
            input: 'not json',
        },
    )
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).systemMessage).toContain('hook failed')
})

it('fails open on an unknown event', () => {
    const result = guard('turn-middle')
    expect(result.status).toBe(0)
    expect(result.json.systemMessage).toContain('unknown event "turn-middle"')
})

it('runs the gate even when the agent running the tests has DISABLE_AGENT_GUARD=1', () => {
    const previous = process.env.DISABLE_AGENT_GUARD
    process.env.DISABLE_AGENT_GUARD = '1'
    try {
        guard('turn-start')
        repo.write('src/a.ts', 'export const a = 2\n')
        expect(guard('turn-end').json?.decision).toBe('block')
    } finally {
        if (previous === undefined) delete process.env.DISABLE_AGENT_GUARD
        else process.env.DISABLE_AGENT_GUARD = previous
    }
})

it('does nothing with DISABLE_AGENT_GUARD=1', () => {
    guard('turn-start')
    repo.write('src/a.ts', 'export const a = 2\n')
    const end = guard('turn-end', { session_id: 's1' }, { env: { DISABLE_AGENT_GUARD: '1' } })
    expect(end.stdout).toBe('')
})
