import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vitest/config'

const DIST_DIR = resolve(__dirname, 'dist')
const PRESERVED_DIST_ENTRIES = new Set(['mcp-apps'])

function cleanDistPreservingMcpApps(): Plugin {
    return {
        name: 'clean-dist-preserving-mcp-apps',
        apply: 'build',
        buildStart() {
            if (!existsSync(DIST_DIR)) {
                return
            }

            for (const entry of readdirSync(DIST_DIR)) {
                if (PRESERVED_DIST_ENTRIES.has(entry)) {
                    continue
                }

                rmSync(join(DIST_DIR, entry), { recursive: true, force: true })
            }
        },
    }
}

export default defineConfig({
    plugins: [
        cleanDistPreservingMcpApps(),
        dts({
            include: ['src/**/*'],
            exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/mcp-apps/**/*'],
            entryRoot: 'src',
        }),
    ],

    // Build configuration for library mode
    build: {
        lib: {
            // Multiple entry points for CLI and library
            entry: {
                main: resolve(__dirname, 'src/main.ts'),
                'main-http': resolve(__dirname, 'src/main-http.ts'),
                index: resolve(__dirname, 'src/index.ts'),
            },
            formats: ['es'], // ESM only (matches package.json "type": "module")
            fileName: (_format, entryName) => `${entryName}.js`,
        },
        rollupOptions: {
            // Externalize dependencies to avoid bundling them
            external: [
                '@modelcontextprotocol/node',
                '@modelcontextprotocol/server',
                '@doist/todoist-sdk',
                'date-fns',
                'dotenv',
                'express',
                'zod',
                // Node.js built-ins (both forms)
                'node:path',
                'node:fs',
                'node:url',
                'node:process',
                'path',
                'fs',
                'url',
                'process',
                /^node:/,
            ],
            output: {
                // Generate declarations separately
                preserveModules: false,
            },
        },
        target: 'node18', // Target Node.js 18+
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: false,
        ssr: true, // Server-side rendering mode for Node.js
        minify: true,
    },

    // Enable ?raw imports for future HTML/CSS template loading
    assetsInclude: ['**/*.html', '**/*.css'],

    // Test configuration with Vitest
    test: {
        globals: true, // Enable global test APIs (describe, it, expect, etc.)
        environment: 'node',
        include: ['src/**/*.{test,spec}.{js,ts}'],
        exclude: ['node_modules', 'dist'],
        // Optimize for CI - avoid unnecessary bundling
        server: {
            deps: {
                external: ['rollup'],
            },
        },
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/main.ts', // Exclude the MCP server entry point
                'src/**/*.test.ts',
                'src/**/*.spec.ts',
            ],
            reporter: ['text', 'json', 'html'],
        },
    },

    // Resolve configuration
    resolve: {
        alias: {
            // Enable clean imports within src/
            '@': resolve(__dirname, 'src'),
        },
    },

    // Ensure proper handling of ESM for Node.js
    esbuild: {
        target: 'node18',
        format: 'esm',
        platform: 'node',
    },
})
