// Agent tooling state lives in the checkout's gitignored .tmp/agents/, not in .git/:
// Codex's sandbox cannot write .git/, and each worktree keeps its own state.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function stateDir(root: string): string {
    return join(root, '.tmp/agents')
}

export function readJson<T>(path: string): T | undefined {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T
    } catch {
        return undefined
    }
}

export function writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export type VerifiedRecord = { fingerprint: string; head: string; at: string }

const verifiedPath = (root: string) => join(stateDir(root), 'verified.json')

export const readVerified = (root: string) => readJson<VerifiedRecord>(verifiedPath(root))
export const writeVerified = (root: string, record: VerifiedRecord) =>
    writeJson(verifiedPath(root), record)
export const clearVerified = (root: string) => rmSync(verifiedPath(root), { force: true })
