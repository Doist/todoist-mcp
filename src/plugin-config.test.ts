import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readJson(relative: string) {
    return JSON.parse(readFileSync(join(repoRoot, relative), 'utf8'))
}

describe('Claude Code plugin manifests', () => {
    it.each(['.claude-plugin/plugin.json', 'plugins/todoist/.claude-plugin/plugin.json'])(
        '%s shape and version match package.json',
        (path) => {
            const plugin = readJson(path)
            const pkg = readJson('package.json')
            expect(plugin.name).toBe('todoist')
            expect(plugin.version).toBe(pkg.version)
            expect(plugin.description).toMatch(/Todoist/)
            expect(plugin.author?.name).toBe('Doist')
            expect(plugin.repository).toMatch(/todoist-mcp/)
        },
    )

    it('marketplace.json wires the todoist plugin to this repo', () => {
        const marketplace = readJson('.claude-plugin/marketplace.json')
        expect(marketplace.name).toBe('doist')
        expect(marketplace.owner?.name).toBe('Doist')
        expect(marketplace.plugins).toHaveLength(1)
        const [plugin] = marketplace.plugins
        expect(plugin.name).toBe('todoist')
        expect(plugin.source).toBe('./plugins/todoist')
        expect(readJson(`${plugin.source}/.claude-plugin/plugin.json`).name).toBe(plugin.name)
    })

    it('.mcp.json declares the HTTP transport for the remote server', () => {
        const mcp = readJson('.mcp.json')
        expect(mcp.mcpServers?.todoist?.type).toBe('http')
        expect(mcp.mcpServers?.todoist?.url).toBe('https://ai.todoist.net/mcp')
        expect(readJson('plugins/todoist/.mcp.json')).toEqual(mcp)
    })
})

describe('release config plugin-version sync', () => {
    it('release.config.js bumps and commits both plugin manifests', async () => {
        const { default: config } = await import(
            pathToFileURL(join(repoRoot, 'release.config.js')).href
        )
        const plugins = config.plugins.filter(Array.isArray) as [string, Record<string, unknown>][]
        const exec = plugins.find(([name]) => name === '@semantic-release/exec')?.[1]
        const git = plugins.find(([name]) => name === '@semantic-release/git')?.[1]
        expect(exec?.prepareCmd).toBe(
            // oxlint-disable-next-line no-template-curly-in-string -- semantic-release template
            'node scripts/bump-plugin-version.mjs ${nextRelease.version}',
        )
        expect(git?.assets).toEqual(
            expect.arrayContaining([
                '.claude-plugin/plugin.json',
                'plugins/todoist/.claude-plugin/plugin.json',
            ]),
        )
    })
})

describe('bump-plugin-version script', () => {
    it('keeps both installable plugins on the released version by default', () => {
        const dir = mkdtempSync(join(tmpdir(), 'plugin-release-'))
        const paths = ['.claude-plugin/plugin.json', 'plugins/todoist/.claude-plugin/plugin.json']
        for (const path of paths) {
            mkdirSync(join(dir, path, '..'), { recursive: true })
            writeFileSync(join(dir, path), JSON.stringify({ name: 'todoist', version: '0.0.0' }))
        }

        execFileSync('node', [join(repoRoot, 'scripts/bump-plugin-version.mjs'), '1.2.3'], {
            cwd: dir,
        })

        for (const path of paths) {
            expect(JSON.parse(readFileSync(join(dir, path), 'utf8'))).toEqual({
                name: 'todoist',
                version: '1.2.3',
            })
        }
    })

    it('updates the version field of the target manifest in place', () => {
        const dir = mkdtempSync(join(tmpdir(), 'plugin-bump-'))
        const path = join(dir, 'plugin.json')
        writeFileSync(
            path,
            `${JSON.stringify({ name: 'todoist', version: '0.0.0', description: 'x' }, null, 4)}\n`,
        )

        execFileSync('node', ['scripts/bump-plugin-version.mjs', '1.2.3', path], {
            cwd: repoRoot,
        })

        const updated = JSON.parse(readFileSync(path, 'utf8'))
        expect(updated.version).toBe('1.2.3')
        expect(updated.name).toBe('todoist')
        expect(updated.description).toBe('x')
    })

    it('exits with error when version arg is missing', () => {
        expect(() =>
            execFileSync('node', ['scripts/bump-plugin-version.mjs'], {
                cwd: repoRoot,
                stdio: 'pipe',
            }),
        ).toThrow()
    })
})
