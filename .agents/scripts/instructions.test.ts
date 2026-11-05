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
    join(REPO_ROOT, 'CODEBASE.md'),
    join(REPO_ROOT, 'docs/agents.md'),
    ...markdownFiles(join(REPO_ROOT, '.agents')),
]

const tracked = git(REPO_ROOT, ['ls-files', '--cached', '--others', '--exclude-standard'])
    .stdout.split('\n')
    .filter(Boolean)
const scripts = Object.keys(
    (
        JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>
        }
    ).scripts,
)

const ROOTED = /^(src|tools|scripts|docs|\.agents|\.github|\.husky|\.claude|\.codex|\.cursor)\//
const FILE_NAME = /^[\w.-]+\.(md|json|ts|tsx|js|cjs|mjs|sh|yml|yaml)$/
// A path relative to the document, like `references/test-rules.md` in a skill.
const RELATIVE_FILE = /^[\w.-]+(\/[\w.-]+)+\.(md|json|ts|sh)$/
// Output and state that exist only after a build or run.
const GENERATED = /^(\.tmp|tmp|dist|node_modules|\.husky\/_)(\/|$)/
// MCP method names look like paths.
const NOT_PATHS = new Set(['tools/list', 'tools/call', 'resources/read'])

type Reference = { path: string; line?: number }

/** Paths named in backticks, with an optional `:line`. Placeholders (`<tool>`, `*`) are skipped. */
function namedPaths(text: string): Reference[] {
    return [...text.matchAll(/`([^`\s]+)`/g)]
        .map((match) => match[1] ?? '')
        .filter((value) => !/[<>*{}]/.test(value) && !GENERATED.test(value))
        .map((value) => {
            const [, path = value, line] = value.match(/^(.*?):(\d+)$/) ?? []
            return { path, line: line ? Number(line) : undefined }
        })
        .filter(
            ({ path }) =>
                (ROOTED.test(path) && !NOT_PATHS.has(path)) ||
                FILE_NAME.test(path) ||
                RELATIVE_FILE.test(path),
        )
}

/** The repository path a reference names, or why it doesn't resolve. */
function resolveReference(path: string, doc: string): string | { problem: string } {
    if (!ROOTED.test(path) && path.includes('/')) {
        const local = relative(REPO_ROOT, resolve(dirname(doc), path))
        if (existsSync(join(REPO_ROOT, local))) return local
    }
    if (ROOTED.test(path) || path.includes('/') || existsSync(join(REPO_ROOT, path))) {
        return existsSync(join(REPO_ROOT, path)) ? path : { problem: 'does not exist' }
    }
    const matches = tracked.filter((candidate) => basename(candidate) === path)
    if (matches.length === 1) return matches[0] ?? path
    return {
        problem: matches.length === 0 ? 'does not exist' : `is ambiguous: ${matches.join(', ')}`,
    }
}

function brokenReferences(text: string, doc: string): string[] {
    return namedPaths(text).flatMap(({ path, line }) => {
        const resolved = resolveReference(path, doc)
        if (typeof resolved !== 'string') return [`${path} ${resolved.problem}`]
        if (line === undefined) return []
        const full = join(REPO_ROOT, resolved)
        if (lstatSync(full).isDirectory()) return [`${path}:${line} names a line in a folder`]
        const lines = readFileSync(full, 'utf8').split('\n').length
        return line > lines ? [`${path}:${line} is past the end (${lines} lines)`] : []
    })
}

/** Backticked names in the bullet list under a heading. */
function listedUnder(text: string, heading: string): string[] {
    const section = text.split(heading)[1]?.split(/\n#{1,3} /)[0] ?? ''
    return [...section.matchAll(/^- `([\w-]+)`/gm)].map((match) => match[1] ?? '')
}

describe.each(DOCS.map((path) => [relative(REPO_ROOT, path), path]))('%s', (_name, path) => {
    const text = readFileSync(path, 'utf8')

    it('names only files and lines that exist', () => {
        expect(brokenReferences(text, path)).toEqual([])
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

it('lists every skill in AGENTS.md, and only those', () => {
    const text = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8')
    expect(listedUnder(text, '## Skills').toSorted()).toEqual(skills.toSorted())
})

it('names only test helpers that src/utils/test-helpers.ts exports', () => {
    const skill = readFileSync(join(SKILLS_DIR, 'write-tests/SKILL.md'), 'utf8')
    const section = skill.split('## Helpers')[1]?.split('\n## ')[0] ?? ''
    const named = [...section.matchAll(/`(\w+)`/g)].map((match) => match[1] ?? '')
    const helpers = readFileSync(join(REPO_ROOT, 'src/utils/test-helpers.ts'), 'utf8')
    const exported = [...helpers.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1])
    expect(named.length).toBeGreaterThan(5)
    expect(named.filter((name) => !exported.includes(name))).toEqual([])
})

const checks = readdirSync(join(REPO_ROOT, '.agents/checks')).filter((name) => name.endsWith('.md'))

describe.each(checks)('check %s', (check) => {
    const text = readFileSync(join(REPO_ROOT, '.agents/checks', check), 'utf8')

    it('says what to report and what is fine', () => {
        expect(text).toMatch(/^## Report$/m)
        expect(text).toMatch(/^## Fine$/m)
    })

    it('is linked from AGENTS.md, where Doistbot finds it', () => {
        const agents = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8')
        expect(agents).toContain(`](.agents/checks/${check})`)
    })
})

it('has no Claude Code skill link without a skill behind it', () => {
    const links = readdirSync(join(REPO_ROOT, '.claude/skills'))
    expect(links.toSorted()).toEqual(skills.toSorted())
})
