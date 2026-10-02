import type { TodoistApi } from '@doist/todoist-sdk'
import { describe, expect, it } from 'vitest'
import {
    createFileUploadIssuer,
    createUploadTicket,
    getFileUploadIssuer,
    isTodoistAttachmentUrl,
    readUploadTicket,
    setFileUploadIssuer,
} from './file-uploads.js'

const SECRET = 'a'.repeat(32)
const PAYLOAD = {
    token: 'todoist-token',
    fileName: 'report.pdf',
    maxBytes: 1000,
    expiresAt: Date.now() + 60_000,
}

describe('upload tickets', () => {
    it('round-trips the payload', () => {
        const ticket = createUploadTicket(PAYLOAD, SECRET)
        expect(readUploadTicket(ticket, SECRET)).toEqual({ ok: true, payload: PAYLOAD })
    })

    it('does not expose the token in the ticket', () => {
        const ticket = createUploadTicket(PAYLOAD, SECRET)
        expect(Buffer.from(ticket, 'base64url').toString('utf8')).not.toContain('todoist-token')
    })

    it('rejects a ticket encrypted with another secret', () => {
        const ticket = createUploadTicket(PAYLOAD, SECRET)
        expect(readUploadTicket(ticket, 'b'.repeat(32))).toEqual({ ok: false, reason: 'invalid' })
    })

    it('rejects a tampered ticket', () => {
        const raw = Buffer.from(createUploadTicket(PAYLOAD, SECRET), 'base64url')
        raw[raw.length - 20] = (raw[raw.length - 20] ?? 0) ^ 0xff
        expect(readUploadTicket(raw.toString('base64url'), SECRET)).toEqual({
            ok: false,
            reason: 'invalid',
        })
    })

    it('rejects garbage', () => {
        expect(readUploadTicket('not-a-ticket', SECRET)).toEqual({ ok: false, reason: 'invalid' })
    })

    it('reports an expired ticket as expired', () => {
        const ticket = createUploadTicket(PAYLOAD, SECRET)
        expect(readUploadTicket(ticket, SECRET, PAYLOAD.expiresAt)).toEqual({
            ok: false,
            reason: 'expired',
        })
    })

    it('refuses a short secret', () => {
        expect(() => createUploadTicket(PAYLOAD, 'short')).toThrow(/at least 32/)
    })
})

describe('createFileUploadIssuer', () => {
    it('issues a URL on the public origin whose ticket carries the token', () => {
        const issuer = createFileUploadIssuer(
            {
                secret: SECRET,
                publicUrl: 'https://mcp.example.com/some/path',
                ttlSeconds: 60,
                maxBytes: 42,
            },
            'todoist-token',
        )
        const { uploadUrl, maxBytes, expiresAt } = issuer.issue('notes.md')

        expect(maxBytes).toBe(42)
        expect(uploadUrl.startsWith('https://mcp.example.com/uploads/')).toBe(true)
        const ticket = uploadUrl.slice('https://mcp.example.com/uploads/'.length)
        const result = readUploadTicket(ticket, SECRET)
        expect(result).toEqual({
            ok: true,
            payload: {
                token: 'todoist-token',
                fileName: 'notes.md',
                maxBytes: 42,
                expiresAt: expiresAt.getTime(),
            },
        })
    })

    it('fails fast on a short secret', () => {
        expect(() =>
            createFileUploadIssuer({ secret: 'short', publicUrl: 'https://x.example' }, 't'),
        ).toThrow(/at least 32/)
    })

    it('is looked up by client', () => {
        const client = {} as TodoistApi
        expect(getFileUploadIssuer(client)).toBeUndefined()
        const issuer = createFileUploadIssuer(
            { secret: SECRET, publicUrl: 'https://x.example' },
            't',
        )
        setFileUploadIssuer(client, issuer)
        expect(getFileUploadIssuer(client)).toBe(issuer)
    })
})

describe('isTodoistAttachmentUrl', () => {
    it.each([
        ['https://files.todoist.com/abc/report.pdf', true],
        ['https://todoist.b-cdn.net/abc/report.pdf', true],
        ['https://d1ysz50cxb9zwl.cloudfront.net/abc/report.pdf', true],
        ['http://files.todoist.com/abc/report.pdf', false],
        ['https://evil.example/report.pdf', false],
        ['https://files.todoist.com.evil.example/x', false],
        ['not a url', false],
    ])('%s -> %s', (url, expected) => {
        expect(isTodoistAttachmentUrl(url)).toBe(expected)
    })
})
