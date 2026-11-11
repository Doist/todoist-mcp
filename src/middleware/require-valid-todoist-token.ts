import {
    buildBearerChallenge,
    createTokenVerdictCache,
    type TokenValidationResult,
    type TokenVerdictCache,
} from '@todoist/mcp-core/host'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

import { validateTodoistToken } from '../utils/validate-todoist-token.js'

type StaticTokenSource = {
    type: 'static'
    apiKey: string
    baseUrl?: string
}

type DynamicTokenSource = {
    type: 'dynamic'
    getApiKey: (req: Request) => string | undefined
    baseUrl?: string
}

type TokenSource = StaticTokenSource | DynamicTokenSource

type RequireValidTodoistTokenOptions = TokenSource & {
    /**
     * Cache TTL in milliseconds. Defaults to 300_000 (5 minutes) for static,
     * 120_000 (2 minutes) for dynamic.
     */
    cacheTtlMs?: number

    /**
     * URL for the Protected Resource Metadata document (RFC 9728).
     * Included in the WWW-Authenticate header when returning 401.
     * If omitted, the header is sent without resource_metadata.
     */
    resourceMetadataUrl?: string
}

const DEFAULT_STATIC_TTL_MS = 300_000 // 5 minutes
const DEFAULT_DYNAMIC_TTL_MS = 120_000 // 2 minutes
const MAX_CACHE_SIZE = 10_000

/**
 * One verdict cache per TTL, shared by every middleware with that TTL, so the number of caches
 * stays bounded however many middlewares are built.
 */
const caches = new Map<number, TokenVerdictCache>()

function cacheFor(ttlMs: number): TokenVerdictCache {
    let verdicts = caches.get(ttlMs)
    if (!verdicts) {
        // Reads the clock on every call, so a test's fake timers apply whenever this was created.
        verdicts = createTokenVerdictCache({
            ttlMs,
            maxEntries: MAX_CACHE_SIZE,
            now: () => Date.now(),
        })
        caches.set(ttlMs, verdicts)
    }
    return verdicts
}

function sendUnauthorized(res: Response, resourceMetadataUrl?: string): void {
    res.status(401).set('WWW-Authenticate', buildBearerChallenge({ resourceMetadataUrl })).json({
        error: 'invalid_token',
        error_description: 'Todoist API token is invalid or expired',
    })
}

/**
 * RFC 6750 `insufficient_scope`: the token authenticates but lacks a scope the tools need, so the
 * client asks for consent again rather than refreshing the same token.
 */
function sendForbidden(res: Response, resourceMetadataUrl?: string): void {
    res.status(403)
        .set(
            'WWW-Authenticate',
            buildBearerChallenge({ error: 'insufficient_scope', resourceMetadataUrl }),
        )
        .json({
            error: 'insufficient_scope',
            error_description: 'Todoist API token does not have the required scopes',
        })
}

function respond(
    result: TokenValidationResult,
    res: Response,
    next: NextFunction,
    resourceMetadataUrl?: string,
): void {
    if (result === 'valid') {
        next()
    } else if (result === 'forbidden') {
        sendForbidden(res, resourceMetadataUrl)
    } else {
        sendUnauthorized(res, resourceMetadataUrl)
    }
}

/**
 * Express middleware that validates the Todoist API token before MCP processing.
 *
 * Returns HTTP 401 with a spec-compliant WWW-Authenticate header if the token
 * is invalid, allowing MCP clients to trigger OAuth token refresh, and 403 with
 * an `insufficient_scope` challenge if it lacks a scope the tools need.
 */
function requireValidTodoistToken(options: RequireValidTodoistTokenOptions): RequestHandler {
    const defaultTtl = options.type === 'static' ? DEFAULT_STATIC_TTL_MS : DEFAULT_DYNAMIC_TTL_MS
    const verdicts = cacheFor(options.cacheTtlMs ?? defaultTtl)
    const { resourceMetadataUrl } = options

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const apiKey = options.type === 'static' ? options.apiKey : options.getApiKey(req)

        if (!apiKey) {
            sendUnauthorized(res, resourceMetadataUrl)
            return
        }

        const cached = verdicts.get(apiKey, options.baseUrl)
        if (cached !== undefined) {
            respond(cached, res, next, resourceMetadataUrl)
            return
        }

        let result: TokenValidationResult
        try {
            result = await validateTodoistToken(apiKey, options.baseUrl)
        } catch (error) {
            // Fail open on any error, transient or not — don't block all requests
            // during a Todoist API blip. Tool calls will fail with descriptive errors.
            console.warn('[Token validation] Validation failed, proceeding:', error)
            next()
            return
        }
        verdicts.set(apiKey, options.baseUrl, result)
        respond(result, res, next, resourceMetadataUrl)
    }
}

/**
 * Clear the token validation cache. Useful for testing.
 */
function clearTokenValidationCache(): void {
    for (const verdicts of caches.values()) verdicts.clear()
}

export { clearTokenValidationCache, requireValidTodoistToken, type RequireValidTodoistTokenOptions }
