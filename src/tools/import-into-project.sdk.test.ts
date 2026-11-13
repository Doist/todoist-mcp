import { TodoistApi } from '@todoist/sdk'
import { importIntoProject } from './import-into-project.js'

describe('CSV import through the real SDK', () => {
    it('sends CSV bytes as a multipart file rather than opening them as a path', async () => {
        const csv =
            '\uFEFFTYPE,CONTENT,DESCRIPTION,INDENT\r\ntask,"État, prêt","Ligne 1\nLigne 2",1\r\n'
        let sentFile: { name: string; content: string; path: string } | undefined
        const client = new TodoistApi('unused-test-token', {
            baseUrl: 'https://todoist.invalid',
            customFetch: async (url, init) => {
                const form = await new Response(init?.body, { headers: init?.headers }).formData()
                const file = form.get('file')
                if (!(file instanceof File)) throw new Error('CSV file part is missing')
                sentFile = {
                    name: file.name,
                    content: Buffer.from(await file.arrayBuffer()).toString('utf8'),
                    // The project is in the route, /projects/{project_id}/import.
                    path: new URL(url).pathname,
                }
                const response = Response.json({
                    status: 'ok',
                    template_type: 'project',
                    projects: [],
                    sections: [],
                    tasks: [],
                    comments: [],
                })
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

        const result = await importIntoProject.execute(
            { projectId: 'test-project', csvFileContent: csv },
            client,
        )

        expect(sentFile).toEqual({
            name: 'template.csv',
            content:
                '\uFEFFTYPE,CONTENT,DESCRIPTION,INDENT\r\ntask,"État, prêt","Ligne 1\nLigne 2",1\r\n',
            path: '/api/v1/projects/test-project/import',
        })
        expect(result.structuredContent?.totalCount).toBe(0)
    })
})
