import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import { buildPromptText, computeDateRange, productivityAnalysis } from './productivity-analysis.js'

function getPromptText(result: GetPromptResult): string {
    // oxlint-disable-next-line no-unsafe-optional-chaining -- test helper, messages always present
    return (result.messages[0]?.content as { type: 'text'; text: string }).text
}

describe('productivity-analysis prompt', () => {
    describe('prompt metadata', () => {
        it('should have correct name and description', () => {
            expect(productivityAnalysis.name).toBe('productivity-analysis')
            expect(productivityAnalysis.title).toBe('Productivity Analysis')
            expect(productivityAnalysis.description).toContain('productivity')
        })
    })

    describe('callback', () => {
        it('should return a valid GetPromptResult with a user message', () => {
            const result = productivityAnalysis.callback({
                period: '7d',
                focus: 'overall',
            })

            expect(result.messages).toHaveLength(1)
            expect(result.messages[0]?.role).toBe('user')
            expect(result.messages[0]?.content.type).toBe('text')
        })

        it('should include tool instructions in the prompt text', () => {
            const result = productivityAnalysis.callback({
                period: '7d',
                focus: 'overall',
            })

            const text = getPromptText(result)
            expect(text).toContain('user-info')
            expect(text).toContain('get-productivity-stats')
            expect(text).toContain('find-completed-tasks')
            expect(text).toContain('get-overview')
        })

        it('should include projectId scope when provided', () => {
            const result = productivityAnalysis.callback({
                period: '7d',
                focus: 'overall',
                projectId: 'proj123',
            })

            const text = getPromptText(result)
            expect(text).toContain('proj123')
            expect(text).toContain('Scope this analysis to project ID: proj123')
        })

        it('should not include projectId text when not provided', () => {
            const result = productivityAnalysis.callback({
                period: '7d',
                focus: 'overall',
            })

            const text = getPromptText(result)
            expect(text).not.toContain('Scope this analysis to project ID')
        })
    })

    describe('focus areas', () => {
        it.each([
            {
                focus: 'overall' as const,
                includes: [
                    'Goal Tracking',
                    'Completion Trends',
                    'Project Distribution',
                    'Recommendations',
                ],
                excludes: [],
                includesOverview: true,
            },
            {
                focus: 'goals' as const,
                includes: ['Goal Tracking'],
                excludes: [
                    '### Completion Trends',
                    '### Project Distribution',
                    '### Recommendations',
                ],
                includesOverview: false,
            },
            {
                focus: 'projects' as const,
                includes: ['Project Distribution'],
                excludes: ['### Goal Tracking', '### Completion Trends', '### Recommendations'],
                includesOverview: true,
            },
            {
                focus: 'trends' as const,
                includes: ['Completion Trends'],
                excludes: ['### Goal Tracking', '### Project Distribution', '### Recommendations'],
                includesOverview: false,
            },
            {
                focus: 'recommendations' as const,
                includes: ['Karma & Momentum', 'Recommendations'],
                excludes: ['### Goal Tracking', '### Completion Trends'],
                includesOverview: false,
            },
        ])(
            'should include correct sections for "$focus" focus',
            ({ focus, includes, excludes, includesOverview }) => {
                const text = buildPromptText({ period: '7d', focus })

                for (const section of includes) {
                    expect(text).toContain(section)
                }
                for (const section of excludes) {
                    expect(text).not.toContain(section)
                }
                if (includesOverview) {
                    expect(text).toContain('get-overview')
                } else {
                    expect(text).not.toContain('get-overview')
                }
            },
        )
    })

    describe('computeDateRange', () => {
        const fixedDate = new Date('2026-03-17T12:00:00Z')

        it.each([
            {
                period: 'today' as const,
                date: fixedDate,
                since: '2026-03-17',
                until: '2026-03-17',
                descriptionContains: 'today',
            },
            {
                period: '7d' as const,
                date: fixedDate,
                since: '2026-03-11',
                until: '2026-03-17',
                descriptionContains: '7 days',
            },
            {
                period: '14d' as const,
                date: fixedDate,
                since: '2026-03-04',
                until: '2026-03-17',
                descriptionContains: '14 days',
            },
            {
                period: '30d' as const,
                date: fixedDate,
                since: '2026-02-16',
                until: '2026-03-17',
                descriptionContains: '30 days',
            },
            {
                period: 'this-week' as const,
                date: fixedDate, // Tuesday
                since: '2026-03-16',
                until: '2026-03-17',
                descriptionContains: 'this week',
            },
            {
                period: 'this-week' as const,
                date: new Date('2026-03-16T12:00:00Z'), // Monday
                since: '2026-03-16',
                until: '2026-03-16',
                descriptionContains: 'this week',
            },
            {
                period: 'this-week' as const,
                date: new Date('2026-03-22T12:00:00Z'), // Sunday
                since: '2026-03-16',
                until: '2026-03-22',
                descriptionContains: 'this week',
            },
            {
                period: 'this-month' as const,
                date: fixedDate,
                since: '2026-03-01',
                until: '2026-03-17',
                descriptionContains: 'this month',
            },
        ])(
            'should compute "$period" period ($since to $until)',
            ({ period, date, since, until, descriptionContains }) => {
                const range = computeDateRange(period, date)

                expect(range.since).toBe(since)
                expect(range.until).toBe(until)
                expect(range.periodDescription).toContain(descriptionContains)
            },
        )

        it('should embed date range in the prompt text', () => {
            const text = buildPromptText({ period: '7d', focus: 'overall' })

            expect(text).toMatch(/since: "\d{4}-\d{2}-\d{2}"/)
            expect(text).toMatch(/until: "\d{4}-\d{2}-\d{2}"/)
        })
    })
})
