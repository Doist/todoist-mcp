import { type PersonalProject, TodoistApi } from '@doist/todoist-sdk'
import { createMockProject } from '../utils/test-helpers.js'
import { addProjects } from './add-projects.js'

function toApiProject(project: PersonalProject) {
    return Object.fromEntries(
        Object.entries(project).map(([key, value]) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            value,
        ]),
    )
}

describe('Personal project limits through the real SDK', () => {
    it('uses snake-case current plan limits to stop batch writes at capacity', async () => {
        const existingProjects = Array.from({ length: 4 }, (_, index) =>
            toApiProject(createMockProject({ id: `existing-${index}` })),
        )
        let creationRequests = 0
        const client = new TodoistApi('unused-test-token', {
            baseUrl: 'https://todoist.invalid',
            customFetch: async (url, init) => {
                let payload: unknown
                switch (`${init?.method} ${new URL(url).pathname}`) {
                    case 'POST /api/v1/sync':
                        payload = {
                            sync_token: 'test-token',
                            full_sync: true,
                            user_plan_limits: {
                                current: { max_projects: 5 },
                                next: { max_projects: 300 },
                            },
                        }
                        break
                    case 'GET /api/v1/projects':
                        payload = { results: existingProjects, next_cursor: null }
                        break
                    case 'POST /api/v1/projects':
                        // Accept every write: enforcement must come from the tool,
                        // not an API rejection beyond the advertised limit.
                        creationRequests++
                        payload = toApiProject(createMockProject({ id: 'created', name: 'First' }))
                        break
                    default:
                        throw new Error(`Unexpected request: ${init?.method} ${url}`)
                }
                const response = Response.json(payload)
                return {
                    ok: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers),
                    text: () => response.text(),
                    json: () => response.json(),
                }
            },
        })

        const result = await addProjects.execute(
            { projects: [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }] },
            client,
        )

        expect(creationRequests).toBe(1)
        expect(result.structuredContent.successCount).toBe(1)
        expect(result.structuredContent.failures).toEqual(
            ['Second', 'Third'].map((item) => ({
                item,
                error: expect.stringContaining('limit of 5 active personal projects'),
            })),
        )
    })
})
