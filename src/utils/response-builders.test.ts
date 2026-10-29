import { previewTasks } from './response-builders.js'

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
