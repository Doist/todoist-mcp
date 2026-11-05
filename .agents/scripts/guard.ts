// The one entry point every agent's hooks call, so the rules can't drift apart per agent.
//
//   node .agents/scripts/guard.ts turn-start   when the person sends a message: snapshot the tree
//   node .agents/scripts/guard.ts turn-end     when the agent stops: may send it back once
//
// Input is the hook's JSON on stdin; Claude Code, Codex and Cursor send compatible shapes, and
// all three read `{"decision":"block","reason":...}` from a Stop hook. It guards the checkout
// this file lives in, not the hook's working directory. A broken guard never blocks work: any
// error allows the action and says why. DISABLE_AGENT_GUARD=1 turns it off. See docs/agents.md.

import { readFileSync } from 'node:fs'

const event = process.argv[2]

function reply(value: Record<string, unknown>): void {
    // No process.exit(): stdout to a hook can be an asynchronous pipe, and exiting early could
    // cut off the JSON.
    process.stdout.write(JSON.stringify(value))
}

function readPayload(): Record<string, unknown> {
    let text = ''
    try {
        text = readFileSync(0, 'utf8')
    } catch {
        return {}
    }
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {}
}

async function main(): Promise<void> {
    if (event !== 'turn-start' && event !== 'turn-end') {
        throw new Error(`unknown event "${event}"`)
    }
    // Imported inside the try, so a broken library file fails open like any other error.
    const { CHECKOUT_ROOT } = await import('./lib/git.ts')
    const { endTurn, startTurn } = await import('./lib/turn-gate.ts')

    const payload = readPayload()
    const sessionId = String(
        payload.session_id ?? payload.conversation_id ?? payload.thread_id ?? 'default',
    )
    if (event === 'turn-start') {
        startTurn({ root: CHECKOUT_ROOT, sessionId })
        return
    }
    const reentry = payload.stop_hook_active === true || Number(payload.loop_count) > 0
    const verdict = endTurn({ root: CHECKOUT_ROOT, sessionId, reentry })
    if (verdict.decision === 'block') {
        reply({ decision: 'block', reason: verdict.reason })
    } else if (verdict.note) {
        reply({ systemMessage: `agent-guard: ${verdict.note}` })
    }
}

if (process.env.DISABLE_AGENT_GUARD !== '1') {
    try {
        await main()
    } catch (error) {
        const message = `agent-guard: ${event ?? 'unknown'} hook failed, so it allowed the action. ${(error as Error)?.message ?? error}`
        process.stderr.write(`${message}\n`)
        reply({ systemMessage: message })
    }
}
