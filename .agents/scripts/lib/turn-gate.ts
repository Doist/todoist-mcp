// The end-of-turn gate. At turn start it snapshots the tree; at turn end it sends the agent back
// once if the turn changed code that `npm run verify` has not passed. "Once" lets an agent stop on
// purpose and say what is unfinished.

import { join } from 'node:path'
import { readJson, readVerified, stateDir, writeJson } from './state.ts'
import { changedPaths, classify, codeFingerprint, type Snapshot, snapshot } from './tree.ts'

type TurnState = { start: Snapshot; sentBack: boolean }

export type Verdict = { decision: 'allow'; note?: string } | { decision: 'block'; reason: string }

const MAX_LISTED = 5

function turnPath(root: string, sessionId: string): string {
    return join(stateDir(root), 'turns', `${sessionId.replace(/[^\w.-]/g, '_')}.json`)
}

function list(paths: string[]): string {
    const shown = paths.slice(0, MAX_LISTED).join(', ')
    return paths.length > MAX_LISTED ? `${shown} and ${paths.length - MAX_LISTED} more` : shown
}

export function startTurn({ root, sessionId }: { root: string; sessionId: string }): void {
    writeJson(turnPath(root, sessionId), { start: snapshot(root), sentBack: false })
}

export function endTurn({
    root,
    sessionId,
    reentry = false,
}: {
    root: string
    sessionId: string
    /** The agent already went back once this turn (Claude Code's `stop_hook_active`). */
    reentry?: boolean
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
    const code = changed.filter((file) => classify(file) === 'code')
    const ciOnly = changed.filter((file) => classify(file) === 'unchecked')
    const ciNote = ciOnly.length
        ? `only CI checks ${list(ciOnly)}; say so in your report`
        : undefined

    if (code.length === 0) return { decision: 'allow', note: ciNote }
    if (readVerified(root)?.fingerprint === codeFingerprint(now)) {
        return { decision: 'allow', note: ciNote }
    }

    if (reentry || state.sentBack) {
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
