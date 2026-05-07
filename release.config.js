/**
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
    branches: ['main'],
    plugins: [
        ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
        ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
        '@semantic-release/changelog',
        '@semantic-release/npm',
        [
            '@semantic-release/exec',
            {
                // oxlint-disable-next-line no-template-curly-in-string -- semantic-release template
                prepareCmd: 'node scripts/bump-plugin-version.mjs ${nextRelease.version}',
            },
        ],
        [
            '@semantic-release/git',
            {
                assets: [
                    'CHANGELOG.md',
                    'package.json',
                    'package-lock.json',
                    '.claude-plugin/plugin.json',
                ],
                // oxlint-disable-next-line no-template-curly-in-string -- semantic-release template
                message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
            },
        ],
        '@semantic-release/github',
    ],
}
