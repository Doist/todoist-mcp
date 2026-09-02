import { describe, expect, it } from 'vitest'
import { buildResponsibleUserQueryFilter, filterTasksByResponsibleUser } from './filter-helpers.js'

describe('filter helpers', () => {
    describe('buildResponsibleUserQueryFilter', () => {
        it('includes unassigned tasks when the resolved user is the current user', () => {
            expect(
                buildResponsibleUserQueryFilter({
                    resolvedAssigneeId: 'current-user',
                    assigneeEmail: 'avery.inboxworthy@example.com',
                    currentUserId: 'current-user',
                    responsibleUserFiltering: 'all',
                }),
            ).toBe('!assigned to: others')
        })

        it('keeps a resolved user filter strict when the current user is unavailable', () => {
            expect(
                buildResponsibleUserQueryFilter({
                    resolvedAssigneeId: 'current-user',
                    assigneeEmail: 'avery.inboxworthy@example.com',
                }),
            ).toBe('assigned to: avery.inboxworthy@example.com')
        })
    })

    describe('filterTasksByResponsibleUser', () => {
        it('includes unassigned tasks when the resolved user is the current user', () => {
            const tasks = [
                { id: 'mine', responsibleUid: 'current-user' },
                { id: 'unassigned' },
                { id: 'someone-else', responsibleUid: 'other-user' },
            ]

            expect(
                filterTasksByResponsibleUser({
                    tasks,
                    resolvedAssigneeId: 'current-user',
                    currentUserId: 'current-user',
                    responsibleUserFiltering: 'all',
                }),
            ).toEqual([tasks[0], tasks[1]])
        })
    })
})
