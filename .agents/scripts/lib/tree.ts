// Fingerprints of the working tree, by file content. Hashing content (not mtimes) catches edits
// made in the same second, and hashing in-process writes nothing to git's object store.

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.ts'

/** Path → content hash for every tracked and untracked, non-ignored file. */
export type Snapshot = Record<string, string>

export function snapshot(root: string): Snapshot {
    const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    if (!listed.ok) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`)
    const files: Snapshot = {}
    for (const path of new Set(listed.stdout.split('\0').filter(Boolean))) {
        files[path] = hashPath(join(root, path))
    }
    return files
}

function hashPath(path: string): string {
    let stat
    try {
        stat = lstatSync(path)
    } catch {
        return 'missing'
    }
    const hash = createHash('sha256')
    if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(path)}`)
    else if (stat.isDirectory())
        hash.update('dir') // a nested repository, listed but not entered
    else hash.update(`${stat.mode & 0o111 ? 'x' : '-'}:`).update(readFileSync(path))
    return hash.digest('hex')
}

/** The kind of file, as far as local checks are concerned. */
export type FileKind = 'docs' | 'unchecked' | 'code'

/**
 * - docs: prose no check reads. Markdown under src/ is excluded, since it could be loaded at runtime.
 * - unchecked: files only CI reads (workflows, Renovate). Local verification cannot vouch for them.
 * - code: everything else, including config, lockfiles, skills' scripts and tests.
 */
export function classify(path: string): FileKind {
    if (path.startsWith('.github/')) return path.endsWith('.md') ? 'docs' : 'unchecked'
    if (path.endsWith('.md') && !path.startsWith('src/')) return 'docs'
    if (path === 'LICENSE') return 'docs'
    return 'code'
}

/** Hash of every file that is not docs, so a docs edit after verification keeps the pass. */
export function codeFingerprint(files: Snapshot): string {
    const hash = createHash('sha256')
    for (const path of Object.keys(files).sort()) {
        if (classify(path) !== 'docs') hash.update(`${path}\0${files[path]}\n`)
    }
    return hash.digest('hex')
}

export function changedPaths(before: Snapshot, after: Snapshot): string[] {
    const paths = new Set([...Object.keys(before), ...Object.keys(after)])
    return [...paths].filter((path) => before[path] !== after[path]).sort()
}

/** Files that differ from `base`: committed, staged, unstaged and untracked. */
export function changedSince(root: string, base: string): string[] {
    const diff = git(root, ['diff', '--name-only', '-z', '--no-renames', base])
    if (!diff.ok) throw new Error(`git diff failed: ${diff.stderr.trim()}`)
    const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
    const paths = [...diff.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean)
    return [...new Set(paths)].sort()
}
