import { isIP } from 'node:net'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { isLoopbackHost, normalizeListenHost } from '../utils/host.js'

type RequireTrustedHostOptions = {
    /**
     * Port-agnostic hostnames permitted in the `Host` and `Origin` headers.
     * IPv6 entries must be bracketed, e.g. `[::1]`, to match how the URL parser
     * normalises hostnames.
     */
    allowedHosts: string[]
}

/**
 * Loopback hostnames always trusted by {@link requireTrustedHost}. Stored
 * bracketed for IPv6 because `new URL('http://[::1]').hostname` returns `[::1]`.
 */
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/**
 * Extract the hostname from a `Host` (scheme-less) or `Origin` (with scheme)
 * header value, port-agnostic and lowercased. Returns `undefined` when the
 * value cannot be parsed (e.g. the literal `null` origin).
 */
function parseHostname(value: string): string | undefined {
    try {
        const url = value.includes('://') ? new URL(value) : new URL(`http://${value}`)
        return url.hostname.toLowerCase()
    } catch {
        return undefined
    }
}

/**
 * Build the list of hostnames trusted in the Host and Origin headers. Always
 * includes the loopback defaults, plus any names from `allowedHostsEnv`
 * (comma-separated), plus the configured `host` when it is a concrete
 * non-loopback interface (e.g. a direct bind to 192.168.1.50). Bind wildcards
 * (0.0.0.0/::) are never added because they are never valid Host header values —
 * operators exposing on a wildcard must enumerate client hostnames via
 * ALLOWED_HOSTS.
 */
function buildAllowedHosts(host: string, allowedHostsEnv?: string): string[] {
    const hosts = new Set(DEFAULT_ALLOWED_HOSTS)

    for (const entry of (allowedHostsEnv ?? '').split(',')) {
        const trimmed = entry.trim()
        if (trimmed) {
            hosts.add(trimmed)
        }
    }

    const normalizedHost = normalizeListenHost(host)
    if (
        normalizedHost &&
        normalizedHost !== '0.0.0.0' &&
        normalizedHost !== '::' &&
        !isLoopbackHost(normalizedHost)
    ) {
        // Re-bracket IPv6 so the entry matches what parseHostname() produces for
        // request headers (e.g. `[2001:db8::1]`); otherwise IPv6 binds 403.
        hosts.add(isIP(normalizedHost) === 6 ? `[${normalizedHost}]` : normalizedHost)
    }

    return [...hosts]
}

function forbidden(res: Response, message: string): void {
    res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message },
        id: null,
    })
}

/**
 * Express middleware that rejects requests whose `Host` or `Origin` header is
 * not in the trusted allowlist. This is DNS-rebinding protection: a malicious
 * website that rebinds its domain to a victim's loopback address keeps its own
 * `Host`/`Origin`, so string-matching against the allowlist (we never DNS
 * resolve) blocks the request before it can reach the MCP transport.
 *
 * - Missing `Host` → 403.
 * - `Host` hostname not in the allowlist → 403.
 * - `Origin` absent → allowed (non-browser clients such as `mcp-remote`/`curl`
 *   send none; the browser attack path always sends one).
 * - `Origin` present but untrusted or unparseable → 403.
 */
function requireTrustedHost(options: RequireTrustedHostOptions): RequestHandler {
    // Canonicalise each allowed host through the same parser used for incoming
    // headers so differently formatted-but-equivalent literals match — e.g. an
    // expanded IPv6 entry `[2001:db8:0:0:0:0:0:1]` and a request's compressed
    // `[2001:db8::1]` both normalise to the same value. Unparseable entries are
    // dropped rather than silently mismatching.
    const allow = new Set<string>()
    for (const host of options.allowedHosts) {
        const canonical = parseHostname(host)
        if (canonical) {
            allow.add(canonical)
        }
    }

    return (req: Request, res: Response, next: NextFunction): void => {
        const hostHeader = req.headers.host
        if (!hostHeader) {
            forbidden(res, 'Missing Host header')
            return
        }

        const hostname = parseHostname(hostHeader)
        if (!hostname || !allow.has(hostname)) {
            forbidden(res, `Invalid Host: ${hostHeader}`)
            return
        }

        const origin = req.headers.origin
        if (origin) {
            const originHostname = parseHostname(origin)
            if (!originHostname || !allow.has(originHostname)) {
                forbidden(res, `Invalid Origin: ${origin}`)
                return
            }
        }

        next()
    }
}

export {
    DEFAULT_ALLOWED_HOSTS,
    buildAllowedHosts,
    requireTrustedHost,
    type RequireTrustedHostOptions,
}
