import { describe, expect, it } from 'vitest'

import { isLoopbackHost, normalizeListenHost } from './host.js'

describe('normalizeListenHost', () => {
    it('strips brackets from a bracketed IPv6 literal', () => {
        expect(normalizeListenHost('[::1]')).toBe('::1')
        expect(normalizeListenHost('[2001:db8::1]')).toBe('2001:db8::1')
    })

    it('leaves non-bracketed hosts unchanged', () => {
        expect(normalizeListenHost('127.0.0.1')).toBe('127.0.0.1')
        expect(normalizeListenHost('localhost')).toBe('localhost')
    })
})

describe('isLoopbackHost', () => {
    it.each([
        ['localhost'],
        ['127.0.0.1'],
        ['127.10.20.30'],
        ['::1'],
        ['[::1]'],
        ['0:0:0:0:0:0:0:1'],
    ])('treats %s as loopback', (host) => {
        expect(isLoopbackHost(host)).toBe(true)
    })

    it.each([['0.0.0.0'], ['::'], ['192.168.1.50'], ['2001:db8::1'], ['mcp.lan']])(
        'treats %s as non-loopback',
        (host) => {
            expect(isLoopbackHost(host)).toBe(false)
        },
    )
})
