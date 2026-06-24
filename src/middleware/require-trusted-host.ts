import { isIP } from 'node:net'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { normalizeListenHost } from '../utils/host.js'

type RequireTrustedHostOptions = {
    /**
     * Port-agnostic hostnames permitted in the `Host` and `Origin` headers.
     * IPv6 entries must be bracketed, e.g. `[::1]`. Invalid entries cause
     * {@link requireTrustedHost} to throw at construction time (fail fast).
     */
    allowedHosts: string[]
}

/**
 * Loopback hostnames always trusted by {@link requireTrustedHost}. Stored
 * bracketed for IPv6 because `new URL('http://[::1]').hostname` returns `[::1]`.
 */
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]']

// Characters that may appear in a URL but never in a bare `host[:port]`
// authority. Rejecting them keeps `Host` parsing from being fooled by URL-only
// syntax such as `foo@127.0.0.1` (which `new URL()` would normalise to a
// trusted host) or embedded paths/queries/fragments.
const NON_AUTHORITY_CHARS = /[@/\\?#\s]/

/**
 * Canonicalise a bare `host[:port]` authority (a `Host` header value or an
 * allowlist entry) to its port-agnostic, lowercased hostname. Returns
 * `undefined` for anything that isn't a valid authority. IPv6 is canonicalised
 * too, so `[2001:db8:0:0:0:0:0:1]` and `[2001:db8::1]` compare equal.
 */
function canonicalHostFromAuthority(value: string): string | undefined {
    if (NON_AUTHORITY_CHARS.test(value)) {
        return undefined
    }
    try {
        return new URL(`http://${value}`).hostname.toLowerCase()
    } catch {
        return undefined
    }
}

/**
 * Canonicalise an `Origin` header (`scheme://host[:port]`) to its lowercased
 * hostname. Returns `undefined` for the literal `null` origin, malformed values,
 * or anything carrying userinfo / path / query / fragment (a real Origin has
 * none of those).
 */
function canonicalHostFromOrigin(value: string): string | undefined {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return undefined
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        return undefined
    }
    return url.hostname.toLowerCase()
}

/**
 * Build the list of hostnames trusted in the Host and Origin headers. Always
 * includes the loopback defaults, plus any names from `allowedHostsEnv`
 * (comma-separated), plus the configured `host` (so an explicit bind — loopback
 * alias like 127.0.1.1, a LAN IP, etc. — is always trusted). Bind wildcards
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
    if (normalizedHost && normalizedHost !== '0.0.0.0' && normalizedHost !== '::') {
        // Re-bracket IPv6 so the entry is a valid authority and matches what the
        // request side produces (e.g. `[2001:db8::1]`); otherwise IPv6 binds 403.
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
 *
 * Throws at construction time if `allowedHosts` contains an entry that isn't a
 * valid authority, so misconfiguration fails fast instead of becoming opaque
 * 403s at request time.
 */
function requireTrustedHost(options: RequireTrustedHostOptions): RequestHandler {
    // Canonicalise each allowed host through the same parser used for incoming
    // headers so differently formatted-but-equivalent literals match — e.g. an
    // expanded IPv6 entry `[2001:db8:0:0:0:0:0:1]` and a request's compressed
    // `[2001:db8::1]` both normalise to the same value.
    const allow = new Set<string>()
    for (const host of options.allowedHosts) {
        const canonical = canonicalHostFromAuthority(host)
        if (!canonical) {
            throw new Error(
                `Invalid allowed host ${JSON.stringify(host)}: must be a hostname or host:port ` +
                    '(IPv6 literals must be bracketed, e.g. [::1])',
            )
        }
        allow.add(canonical)
    }

    return (req: Request, res: Response, next: NextFunction): void => {
        const hostHeader = req.headers.host
        if (!hostHeader) {
            forbidden(res, 'Missing Host header')
            return
        }

        const hostname = canonicalHostFromAuthority(hostHeader)
        if (!hostname || !allow.has(hostname)) {
            forbidden(res, `Invalid Host: ${hostHeader}`)
            return
        }

        const origin = req.headers.origin
        if (origin) {
            const originHostname = canonicalHostFromOrigin(origin)
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
