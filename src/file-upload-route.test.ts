import type { AddressInfo } from 'node:net'
import type { Readable } from 'node:stream'
import { TodoistRequestError } from '@doist/todoist-sdk'
import express from 'express'
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFileUploadHandler } from './file-upload-route.js'
import { createUploadTicket } from './utils/file-uploads.js'

const uploadFile = vi.fn()

vi.mock('./usage-tracking.js', () => ({
    createTodoistClient: vi.fn(() => ({ uploadFile })),
}))

import { createTodoistClient } from './usage-tracking.js'

const SECRET = 's'.repeat(32)

let server: ReturnType<ReturnType<typeof express>['listen']>
let baseUrl: string

function ticketFor(overrides: Partial<Parameters<typeof createUploadTicket>[0]> = {}): string {
    return createUploadTicket(
        {
            token: 'user-token',
            fileName: 'report.pdf',
            maxBytes: 1024,
            expiresAt: Date.now() + 60_000,
            ...overrides,
        },
        SECRET,
    )
}

async function readAll(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
}

beforeEach(async () => {
    vi.clearAllMocks()
    uploadFile.mockImplementation(
        async ({ file, fileName }: { file: Readable; fileName: string }) => {
            await readAll(file)
            return {
                fileUrl: `https://files.todoist.com/x/${fileName}`,
                fileName,
                fileType: 'application/pdf',
                resourceType: 'file',
            }
        },
    )
    const app = express()
    const handler = createFileUploadHandler({ secret: SECRET })
    app.post('/uploads/:ticket', handler)
    app.put('/uploads/:ticket', handler)
    await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => resolve())
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
})

describe('file upload route', () => {
    it('streams the body to Todoist with the ticket token and file name', async () => {
        let received: Buffer | undefined
        uploadFile.mockImplementationOnce(async ({ file }: { file: Readable }) => {
            received = await readAll(file)
            return {
                fileUrl: 'https://files.todoist.com/x/report.pdf',
                fileName: 'report.pdf',
                fileType: 'application/pdf',
                resourceType: 'file',
            }
        })

        const res = await fetch(`${baseUrl}/uploads/${ticketFor()}`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: 'hello file',
        })

        expect(res.status).toBe(201)
        expect(await res.json()).toEqual({
            attachment: {
                fileUrl: 'https://files.todoist.com/x/report.pdf',
                fileName: 'report.pdf',
                fileType: 'application/pdf',
                resourceType: 'file',
            },
        })
        expect(createTodoistClient as Mock).toHaveBeenCalledWith('user-token', {
            baseUrl: undefined,
        })
        expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'report.pdf' }))
        expect(received?.toString()).toBe('hello file')
    })

    it('accepts PUT', async () => {
        const res = await fetch(`${baseUrl}/uploads/${ticketFor()}`, { method: 'PUT', body: 'x' })
        expect(res.status).toBe(201)
    })

    it('rejects an invalid ticket', async () => {
        const res = await fetch(`${baseUrl}/uploads/garbage`, { method: 'POST', body: 'x' })
        expect(res.status).toBe(404)
        expect(uploadFile).not.toHaveBeenCalled()
    })

    it('rejects an expired ticket with 410', async () => {
        const res = await fetch(`${baseUrl}/uploads/${ticketFor({ expiresAt: Date.now() - 1 })}`, {
            method: 'POST',
            body: 'x',
        })
        expect(res.status).toBe(410)
        expect(uploadFile).not.toHaveBeenCalled()
    })

    it('rejects multipart bodies', async () => {
        const form = new FormData()
        form.append('file', new Blob(['x']), 'report.pdf')
        const res = await fetch(`${baseUrl}/uploads/${ticketFor()}`, { method: 'POST', body: form })
        expect(res.status).toBe(415)
        expect(uploadFile).not.toHaveBeenCalled()
    })

    it('rejects a declared length over the limit before uploading', async () => {
        const res = await fetch(`${baseUrl}/uploads/${ticketFor({ maxBytes: 4 })}`, {
            method: 'POST',
            body: 'too long',
        })
        expect(res.status).toBe(413)
        expect(uploadFile).not.toHaveBeenCalled()
    })

    it('cuts off a chunked body that runs over the limit', async () => {
        const encoder = new TextEncoder()
        const body = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('a'.repeat(3)))
                controller.enqueue(encoder.encode('b'.repeat(3)))
                controller.close()
            },
        })
        const res = await fetch(`${baseUrl}/uploads/${ticketFor({ maxBytes: 4 })}`, {
            method: 'POST',
            body,
            duplex: 'half',
        } as RequestInit)
        expect(res.status).toBe(413)
    })

    it('passes Todoist auth failures through as 401', async () => {
        uploadFile.mockRejectedValueOnce(new TodoistRequestError('Unauthorized', 401))
        const res = await fetch(`${baseUrl}/uploads/${ticketFor()}`, { method: 'POST', body: 'x' })
        expect(res.status).toBe(401)
    })

    it('reports other failures as 502', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        uploadFile.mockRejectedValueOnce(new Error('boom'))
        const res = await fetch(`${baseUrl}/uploads/${ticketFor()}`, { method: 'POST', body: 'x' })
        expect(res.status).toBe(502)
    })
})
