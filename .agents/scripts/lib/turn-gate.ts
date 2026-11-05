// The end-of-turn gate. At turn start it snapshots the tree; at turn end it sends the agent back
// once if the turn changed code that `npm run verify` has not passed. "Once" lets an agent stop on
// purpose and say what is unfinished.

import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { branchBase } from './git.ts'
import { readJson, readVerified, stateDir, writeJson } from './state.ts'
import {
    changedCodePaths,
    changedPaths,
    changedSince,
    classify,
    codeFingerprint,
    type Snapshot,
    snapshot,
} from './tree.ts'

type TurnState = { start: Snapshot; sentBack: boolean }

export type Verdict = { decision: 'allow'; note?: string } | { decision: 'block'; reason: string }

const MAX_LISTED = 5
// Turn records older than this belong to sessions that are gone.
const STALE_TURN_MS = 7 * 24 * 60 * 60 * 1000

function turnPath(root: string, sessionId: string): string {
    return join(stateDir(root), 'turns', `${sessionId.replace(/[^\w.-]/g, '_')}.json`)
}

function list(paths: string[]): string {
    const shown = paths.slice(0, MAX_LISTED).join(', ')
    return paths.length > MAX_LISTED ? `${shown} and ${paths.length - MAX_LISTED} more` : shown
}

export function startTurn({ root, sessionId }: { root: string; sessionId: string }): void {
    pruneStaleTurns(root)
    writeJson(turnPath(root, sessionId), { start: snapshot(root), sentBack: false })
}

function pruneStaleTurns(root: string, now = Date.now()): void {
    const dir = join(stateDir(root), 'turns')
    let names: string[]
    try {
        names = readdirSync(dir)
    } catch {
        return
    }
    for (const name of names) {
        const path = join(dir, name)
        if (now - statSync(path).mtimeMs > STALE_TURN_MS) rmSync(path, { force: true })
    }
}

export function endTurn({
    root,
    sessionId,
    base = branchBase(root),
}: {
    root: string
    sessionId: string
    /** Where the branch left the default branch; undefined when there is none. */
    base?: string
}): Verdict {
    const path = turnPath(root, sessionId)
    const state = readJson<TurnState>(path)
    if (!state?.start) {
        return {
            decision: 'allow',
            note: 'no turn-start record for this session, so the end-of-turn check was skipped',
        }
    }

    const now = snapshot(root)
    const changed = changedPaths(state.start, now)
    const code = changedCodePaths(state.start, now)
    const ciOnly = changed.filter((file) => classify(file) === 'unchecked')
    const ciNote = ciOnly.length
        ? `only CI checks ${list(ciOnly)}; say so in your report`
        : undefined

    if (code.length === 0) return { decision: 'allow', note: ciNote }
    const verified = readVerified(root)
    if (verified && verified.fingerprint === codeFingerprint(now)) {
        return { decision: 'allow', note: ciNote }
    }
    // The code is back to what the default branch has (an undo, a stash, a branch switch), which
    // CI already checked. verify says "only docs changed" here and records nothing, so asking for
    // it would send the agent back for nothing.
    if (base && !changedSince(root, base).some((file) => classify(file) === 'code')) {
        return { decision: 'allow', note: ciNote }
    }

    // Only this guard's own record counts: stop_hook_active or loop_count can also be set by
    // another hook sending the agent back, which would skip this one.
    if (state.sentBack) {
        return {
            decision: 'allow',
            note: `the turn ended with changes npm run verify has not passed: ${list(code)}`,
        }
    }

    writeJson(path, { ...state, sentBack: true })
    return {
        decision: 'block',
        reason:
            `You changed code this turn that \`npm run verify\` has not passed: ${list(code)}. ` +
            'Run `npm run verify` and fix what fails. If you are stopping on purpose, say what ' +
            'is unfinished and what you did not verify; you will not be sent back again this turn.',
    }
}
