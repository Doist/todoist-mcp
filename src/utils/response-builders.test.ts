import { previewTasks, summarizeList } from './response-builders.js'

describe('previewTasks', () => {
    const tasks = [
        { id: '1', content: 'Assigned', priority: 'p1' as const, responsibleUid: 'user-ada' },
        { id: '2', content: 'Assigned to a stranger', responsibleUid: 'user-unknown' },
        { id: '3', content: 'Unassigned' },
    ]

    it('shows assignees by short name, falling back to their user ID', () => {
        const preview = previewTasks(tasks, 5, new Map([['user-ada', 'Ada L.']]))

        expect(preview.split('\n')).toEqual([
            '    Assigned • P1 • +Ada L. • id=1',
            '    Assigned to a stranger • +user-unknown • id=2',
            '    Unassigned • id=3',
        ])
    })

    it('leaves assignees out when no names were looked up', () => {
        expect(previewTasks(tasks)).not.toContain('+')
    })
})

describe('summarizeList', () => {
    it('puts notes after the filter line, before the preview', () => {
        const summary = summarizeList({
            subject: 'Completed tasks',
            count: 1,
            filterHints: ['project: home'],
            notes: ['Recurring tasks are not listed.'],
            previewLines: '    Fix the tap • P4 • id=1',
        })

        expect(summary.split('\n')).toEqual([
            'Completed tasks: 1.',
            'Filter: project: home.',
            'Recurring tasks are not listed.',
            'Preview:',
            '    Fix the tap • P4 • id=1',
        ])
    })

    it('keeps notes when there are no results', () => {
        const summary = summarizeList({
            subject: 'Completed tasks',
            count: 0,
            notes: ['Recurring tasks are not listed.'],
            zeroReasonHints: ['Try expanding the date range'],
        })

        expect(summary.split('\n')).toEqual([
            'Completed tasks: 0.',
            'Recurring tasks are not listed.',
            'No results. Try expanding the date range.',
        ])
    })
})
