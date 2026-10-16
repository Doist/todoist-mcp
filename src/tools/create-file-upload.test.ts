import type { TodoistApi } from '@doist/todoist-sdk'
import { describe, expect, it } from 'vitest'
import {
    createFileUploadIssuer,
    readUploadTicket,
    setFileUploadIssuer,
} from '../utils/file-uploads.js'
import { createFileUpload } from './create-file-upload.js'

const SECRET = 'k'.repeat(32)

describe('create-file-upload tool', () => {
    it('returns an upload URL whose ticket names the file', async () => {
        const client = {} as TodoistApi
        setFileUploadIssuer(
            client,
            createFileUploadIssuer(
                { secret: SECRET, publicUrl: 'https://mcp.example.com', maxBytes: 5000 },
                'user-token',
            ),
        )

        const result = await createFileUpload.execute({ fileName: 'report.pdf' }, client)

        const { uploadUrl, method, maxBytes, fileName } = result.structuredContent
        expect(method).toBe('POST')
        expect(maxBytes).toBe(5000)
        expect(fileName).toBe('report.pdf')
        expect(result.textContent).toContain('curl --data-binary')
        expect(result.textContent).toContain(uploadUrl)

        const ticket = readUploadTicket(uploadUrl.split('/uploads/')[1] ?? '', SECRET)
        expect(ticket.ok && ticket.payload.fileName).toBe('report.pdf')
        expect(ticket.ok && ticket.payload.token).toBe('user-token')
    })

    it('explains when uploads are not enabled', async () => {
        await expect(
            createFileUpload.execute({ fileName: 'report.pdf' }, {} as TodoistApi),
        ).rejects.toThrow(/not enabled/)
    })
})
