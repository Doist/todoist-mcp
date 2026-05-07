import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

function readJson(relative: string) {
    return JSON.parse(readFileSync(join(repoRoot, relative), 'utf8'))
}

describe('Claude Code plugin manifests', () => {
    it('plugin.json shape and version match package.json', () => {
        const plugin = readJson('.claude-plugin/plugin.json')
        const pkg = readJson('package.json')
        expect(plugin.name).toBe('todoist')
        expect(plugin.version).toBe(pkg.version)
        expect(plugin.description).toMatch(/Todoist/)
        expect(plugin.author?.name).toBe('Doist')
        expect(plugin.repository).toMatch(/todoist-ai/)
    })

    it('marketplace.json wires the todoist plugin to this repo', () => {
        const marketplace = readJson('.claude-plugin/marketplace.json')
        expect(marketplace.name).toBe('doist')
        expect(marketplace.owner?.name).toBe('Doist')
        expect(marketplace.plugins).toHaveLength(1)
        const [plugin] = marketplace.plugins
        expect(plugin.name).toBe('todoist')
        expect(plugin.source.source).toBe('url')
        expect(plugin.source.url).toMatch(/todoist-ai/)
    })

    it('.mcp.json declares the HTTP transport for the remote server', () => {
        const mcp = readJson('.mcp.json')
        expect(mcp.mcpServers?.todoist?.type).toBe('http')
        expect(mcp.mcpServers?.todoist?.url).toBe('https://ai.todoist.net/mcp')
    })
})

describe('release config plugin-version sync', () => {
    it('release.config.js wires the bump script and includes the manifest in git assets', () => {
        const source = readFileSync(join(repoRoot, 'release.config.js'), 'utf8')
        expect(source).toContain('@semantic-release/exec')
        expect(source).toContain('scripts/bump-plugin-version.mjs')
        expect(source).toContain('.claude-plugin/plugin.json')
    })
})

describe('bump-plugin-version script', () => {
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
