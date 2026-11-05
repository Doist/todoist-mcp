// Instructions that name files or commands that don't exist send agents in circles. This checks
// every path, link and `npm run` script named in the agent-facing docs, and the skills' shape.

import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { git } from './lib/git.ts'
import { REPO_ROOT } from './lib/test-repo.ts'

const SKILLS_DIR = join(REPO_ROOT, '.agents/skills')
const skills = readdirSync(SKILLS_DIR).filter((name) => !name.startsWith('.'))

function markdownFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return markdownFiles(path)
        return entry.name.endsWith('.md') ? [path] : []
    })
}

const DOCS = [
    join(REPO_ROOT, 'AGENTS.md'),
    join(REPO_ROOT, 'docs/agents.md'),
    ...markdownFiles(join(REPO_ROOT, '.agents')),
]

const tracked = git(REPO_ROOT, ['ls-files', '--cached', '--others', '--exclude-standard'])
    .stdout.split('\n')
    .filter(Boolean)
const trackedNames = new Set(tracked.map((path) => basename(path)))
const scripts = Object.keys(
    (
        JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>
        }
    ).scripts,
)

const ROOTED = /^(src|tools|scripts|docs|\.agents|\.github|\.husky|\.claude|\.codex|\.cursor)\//
// A rooted value must end in an extension or a slash: `tools/list` is an MCP method, not a path.
const LOOKS_LIKE_FILE = /(\.\w+|\/)$/
const FILE_NAME = /^[\w.-]+\.(md|json|ts|tsx|js|cjs|mjs|sh|yml|yaml)$/

/** Paths named in backticks, with `:line` suffixes removed. Placeholders (`<tool>`, `*`) are skipped. */
function namedPaths(text: string): string[] {
    return [...text.matchAll(/`([^`\s]+)`/g)]
        .map((match) => (match[1] ?? '').replace(/:\d+$/, ''))
        .filter((value) => !/[<>*{}]/.test(value))
        .filter(
            (value) => (ROOTED.test(value) && LOOKS_LIKE_FILE.test(value)) || FILE_NAME.test(value),
        )
}

function exists(path: string): boolean {
    if (ROOTED.test(path)) return existsSync(join(REPO_ROOT, path))
    return trackedNames.has(path) || existsSync(join(REPO_ROOT, path))
}

describe.each(DOCS.map((path) => [relative(REPO_ROOT, path), path]))('%s', (_name, path) => {
    const text = readFileSync(path, 'utf8')

    it('names only files that exist', () => {
        expect(namedPaths(text).filter((named) => !exists(named))).toEqual([])
    })

    it('links only to files that exist', () => {
        const links = [...text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)]
            .map((match) => match[1] ?? '')
            .filter((link) => !/^[a-z]+:/.test(link))
        expect(links.filter((link) => !existsSync(resolve(dirname(path), link)))).toEqual([])
    })

    it('names only npm scripts that exist', () => {
        const named = [...text.matchAll(/npm run (?:--silent )?([\w:-]+)/g)].map((m) => m[1] ?? '')
        expect(named.filter((script) => !scripts.includes(script))).toEqual([])
    })
})

describe.each(skills)('skill %s', (skill) => {
    const file = join(SKILLS_DIR, skill, 'SKILL.md')
    const text = readFileSync(file, 'utf8')
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? ''

    it('has a name matching its folder and a description that says when to use it', () => {
        expect(frontmatter).toMatch(new RegExp(`^name: ${skill}$`, 'm'))
        const description = frontmatter.match(/^description: (.+)$/m)?.[1] ?? ''
        expect(description).toContain('Use when')
        expect(description.length).toBeLessThan(400)
    })

    it('is linked for Claude Code', () => {
        const link = join(REPO_ROOT, '.claude/skills', skill)
        expect(lstatSync(link).isSymbolicLink()).toBe(true)
        expect(resolve(dirname(link), readlinkSync(link))).toBe(join(SKILLS_DIR, skill))
    })
})

it('has no Claude Code skill link without a skill behind it', () => {
    const links = readdirSync(join(REPO_ROOT, '.claude/skills'))
    expect(links.toSorted()).toEqual(skills.toSorted())
})
