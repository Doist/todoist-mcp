import type { TodoistApi } from '@doist/todoist-sdk'
import { createProfilingClient, expectRequestProfile } from './request-profile.js'
import { createMockTask } from './test-helpers.js'

describe('createProfilingClient', () => {
    it('counts requests per method', async () => {
        const { client, profile } = createProfilingClient({
            updateTask: (id: string) => createMockTask({ id }),
            moveTask: (id: string) => createMockTask({ id }),
        })

        await client.updateTask('a', {})
        await client.updateTask('b', {})
        await client.moveTask('a', { projectId: 'p' })

        expect(profile.count('updateTask')).toBe(2)
        expect(profile.count('moveTask')).toBe(1)
        expect(profile.count('getTasks')).toBe(0)
        expect(profile.total).toBe(3)
    })

    it('reports peak concurrency, not just the total', async () => {
        const { client, profile } = createProfilingClient({
            updateTask: (id: string) => createMockTask({ id }),
        })

        await Promise.all(['a', 'b', 'c'].map((id) => client.updateTask(id, {})))
        expect(profile.peak('updateTask')).toBe(3)

        profile.reset()
        for (const id of ['a', 'b', 'c']) {
            await client.updateTask(id, {})
        }
        // Same three requests, issued one at a time.
        expect(profile.count('updateTask')).toBe(3)
        expect(profile.peak('updateTask')).toBe(1)
    })

    it('records the order requests started in', async () => {
        const { client, profile } = createProfilingClient({
            getUser: () => ({ inboxProjectId: 'inbox-1' }),
            moveTask: (id: string) => createMockTask({ id }),
        })

        await client.getUser()
        await client.moveTask('a', { projectId: 'inbox-1' })

        expect(profile.sequence).toEqual(['getUser', 'moveTask'])
    })

    it('exposes the arguments each request was made with', async () => {
        const { client, profile } = createProfilingClient({
            moveTasks: (ids: string[]) => ids.map((id) => createMockTask({ id })),
        })

        await client.moveTasks(['a', 'b'], { projectId: 'p' })

        expect(profile.argsFor('moveTasks')).toEqual([[['a', 'b'], { projectId: 'p' }]])
    })

    it('returns whatever the handler returns', async () => {
        const { client } = createProfilingClient({
            updateTask: (id: string) => createMockTask({ id, content: 'from handler' }),
        })

        await expect(client.updateTask('a', {})).resolves.toMatchObject({
            id: 'a',
            content: 'from handler',
        })
    })

    it('propagates a throwing handler and still records the request', async () => {
        const { client, profile } = createProfilingClient({
            moveTask: () => {
                throw new Error('nope')
            },
        })

        await expect(client.moveTask('a', { projectId: 'p' })).rejects.toThrow('nope')
        expect(profile.count('moveTask')).toBe(1)
        // A failed request must not leave the in-flight count stuck, or every later
        // peak would be inflated.
        expect(profile.peak('moveTask')).toBe(1)
    })
})

describe('expectRequestProfile', () => {
    async function twoUpdatesOneMove() {
        const { client, profile } = createProfilingClient({
            updateTask: (id: string) => createMockTask({ id }),
            moveTask: (id: string) => createMockTask({ id }),
        })
        await Promise.all([client.updateTask('a', {}), client.updateTask('b', {})])
        await client.moveTask('a', { projectId: 'p' })
        return profile
    }

    it('passes when counts and peaks match', async () => {
        expectRequestProfile(await twoUpdatesOneMove(), {
            updateTask: { count: 2, peak: 2 },
            moveTask: { count: 1, peak: 1 },
        })
    })

    it('defaults peak to whatever happened when only a count is given', async () => {
        expectRequestProfile(await twoUpdatesOneMove(), {
            updateTask: { count: 2 },
            moveTask: { count: 1 },
        })
    })

    it('fails when a request was made that the profile does not mention', async () => {
        const profile = await twoUpdatesOneMove()
        // The point of the helper: a newly introduced request breaks the test instead of
        // going unnoticed.
        expect(() => expectRequestProfile(profile, { updateTask: { count: 2 } })).toThrow()
    })

    it('fails when a count is wrong', async () => {
        const profile = await twoUpdatesOneMove()
        expect(() =>
            expectRequestProfile(profile, {
                updateTask: { count: 1 },
                moveTask: { count: 1 },
            }),
        ).toThrow()
    })

    it('fails when more ran concurrently than expected', async () => {
        const profile = await twoUpdatesOneMove()
        expect(() =>
            expectRequestProfile(profile, {
                updateTask: { count: 2, peak: 1 },
                moveTask: { count: 1, peak: 1 },
            }),
        ).toThrow()
    })
})

describe('the client is usable as a TodoistApi', () => {
    it('satisfies the parameter a tool expects', () => {
        const { client } = createProfilingClient({
            updateTask: (id: string) => createMockTask({ id }),
        })
        const asApi: TodoistApi = client
        expect(typeof asApi.updateTask).toBe('function')
    })
})
