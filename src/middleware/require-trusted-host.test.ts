import type { Request, Response } from 'express'
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    DEFAULT_ALLOWED_HOSTS,
    buildAllowedHosts,
    requireTrustedHost,
} from './require-trusted-host.js'

function createMockRes(): Response {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    }
    return res as unknown as Response
}

function createReq(headers: { host?: string; origin?: string }): Request {
    return { headers } as unknown as Request
}

describe('requireTrustedHost', () => {
    let next: Mock

    beforeEach(() => {
        next = vi.fn()
    })

    describe('Host header validation (loopback defaults)', () => {
        const middleware = requireTrustedHost({ allowedHosts: DEFAULT_ALLOWED_HOSTS })

        it.each([
            ['localhost:3000'],
            ['127.0.0.1:3000'],
            ['[::1]:3000'],
            ['127.0.0.1'],
            ['LOCALHOST:3000'],
        ])('allows trusted host %s', (host) => {
            const res = createMockRes()
            middleware(createReq({ host }), res, next)

            expect(next).toHaveBeenCalledOnce()
            expect(res.status).not.toHaveBeenCalled()
        })

        it('rejects a missing Host header with 403', () => {
            const res = createMockRes()
            middleware(createReq({}), res, next)

            expect(next).not.toHaveBeenCalled()
            expect(res.status).toHaveBeenCalledWith(403)
            expect(res.json).toHaveBeenCalledWith({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Missing Host header' },
                id: null,
            })
        })

        it.each([
            ['attacker.com:3000'],
            // The DNS-rebinding domain: we never resolve it, so the rebound
            // Host (which still carries the attacker's domain) is rejected.
            ['evil.com'],
            ['http://'],
            // URL-only syntax that must not be normalised to a trusted host.
            ['foo@127.0.0.1'],
            ['127.0.0.1/../evil'],
        ])('rejects untrusted/malformed host %s with 403', (host) => {
            const res = createMockRes()
            middleware(createReq({ host }), res, next)

            expect(next).not.toHaveBeenCalled()
            expect(res.status).toHaveBeenCalledWith(403)
        })
    })

    describe('Host header validation (operator-configured allowlist)', () => {
        const middleware = requireTrustedHost({
            allowedHosts: [...DEFAULT_ALLOWED_HOSTS, 'mcp.lan'],
        })

        it('allows the configured host', () => {
            const res = createMockRes()
            middleware(createReq({ host: 'mcp.lan:3000' }), res, next)

            expect(next).toHaveBeenCalledOnce()
        })

        it('rejects a host outside the configured allowlist', () => {
            const res = createMockRes()
            middleware(createReq({ host: 'other.lan' }), res, next)

            expect(next).not.toHaveBeenCalled()
            expect(res.status).toHaveBeenCalledWith(403)
        })
    })

    describe('Origin header validation', () => {
        const middleware = requireTrustedHost({ allowedHosts: DEFAULT_ALLOWED_HOSTS })

        it('allows a trusted host with no Origin (non-browser client)', () => {
            const res = createMockRes()
            middleware(createReq({ host: 'localhost:3000' }), res, next)

            expect(next).toHaveBeenCalledOnce()
        })

        it.each([['http://localhost:3000'], ['http://127.0.0.1:8080']])(
            'allows a trusted Origin %s',
            (origin) => {
                const res = createMockRes()
                middleware(createReq({ host: 'localhost:3000', origin }), res, next)

                expect(next).toHaveBeenCalledOnce()
            },
        )

        it.each([['http://attacker.com'], ['null'], ['not a url']])(
            'rejects untrusted/unparseable Origin %s with 403',
            (origin) => {
                const res = createMockRes()
                middleware(createReq({ host: 'localhost:3000', origin }), res, next)

                expect(next).not.toHaveBeenCalled()
                expect(res.status).toHaveBeenCalledWith(403)
            },
        )
    })
})

describe('buildAllowedHosts', () => {
    it('returns the loopback defaults when HOST is loopback and ALLOWED_HOSTS is unset', () => {
        expect(buildAllowedHosts('127.0.0.1', undefined)).toEqual(DEFAULT_ALLOWED_HOSTS)
    })

    it('auto-includes a concrete non-loopback bind host', () => {
        expect(buildAllowedHosts('192.168.1.50')).toEqual([
            ...DEFAULT_ALLOWED_HOSTS,
            '192.168.1.50',
        ])
    })

    it.each([['[2001:db8::1]'], ['2001:db8::1']])(
        'auto-includes a concrete IPv6 bind host %s in bracketed form',
        (host) => {
            expect(buildAllowedHosts(host)).toEqual([...DEFAULT_ALLOWED_HOSTS, '[2001:db8::1]'])
        },
    )

    it('produces an allowlist that matches IPv6 request hosts end-to-end', () => {
        const middleware = requireTrustedHost({ allowedHosts: buildAllowedHosts('[2001:db8::1]') })
        const res = createMockRes()
        const next = vi.fn()
        middleware(createReq({ host: '[2001:db8::1]:3000' }), res, next)

        expect(next).toHaveBeenCalledOnce()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('matches an expanded IPv6 bind host against a compressed request host', () => {
        // HOST set to the fully expanded literal; the request uses the compressed
        // canonical form. Both must normalise to the same value.
        const middleware = requireTrustedHost({
            allowedHosts: buildAllowedHosts('2001:db8:0:0:0:0:0:1'),
        })
        const res = createMockRes()
        const next = vi.fn()
        middleware(createReq({ host: '[2001:db8::1]:3000' }), res, next)

        expect(next).toHaveBeenCalledOnce()
        expect(res.status).not.toHaveBeenCalled()
    })

    it('auto-includes a non-default loopback alias bind host (e.g. 127.0.1.1)', () => {
        expect(buildAllowedHosts('127.0.1.1')).toEqual([...DEFAULT_ALLOWED_HOSTS, '127.0.1.1'])
    })

    it('does not add the 0.0.0.0 bind wildcard', () => {
        expect(buildAllowedHosts('0.0.0.0')).toEqual(DEFAULT_ALLOWED_HOSTS)
    })

    it('does not add the :: bind wildcard', () => {
        expect(buildAllowedHosts('::')).toEqual(DEFAULT_ALLOWED_HOSTS)
    })

    it('parses ALLOWED_HOSTS, trimming whitespace and dropping empties', () => {
        expect(buildAllowedHosts('0.0.0.0', 'a.lan, b.lan ,')).toEqual([
            ...DEFAULT_ALLOWED_HOSTS,
            'a.lan',
            'b.lan',
        ])
    })

    it('deduplicates entries already present in the defaults', () => {
        expect(buildAllowedHosts('127.0.0.1', 'localhost')).toEqual(DEFAULT_ALLOWED_HOSTS)
    })
})

describe('requireTrustedHost construction', () => {
    it.each([
        ['unbracketed IPv6', '2001:db8::1'],
        ['whitespace', 'bad host'],
        ['userinfo', 'a@b'],
    ])('throws fast on an invalid allowed host (%s)', (_label, badEntry) => {
        expect(() => requireTrustedHost({ allowedHosts: [badEntry] })).toThrow(
            /Invalid allowed host/,
        )
    })

    it('does not throw for valid entries', () => {
        expect(() =>
            requireTrustedHost({ allowedHosts: [...DEFAULT_ALLOWED_HOSTS, 'mcp.lan'] }),
        ).not.toThrow()
    })
})
