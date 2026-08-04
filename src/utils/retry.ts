const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 2000

/**
 * Floor for a jittered delay so a low random draw can't turn a retry into an
 * immediate re-request. Clamped by the computed ceiling, so an explicit
 * zero-delay config (used by tests) still waits nothing.
 */
const MIN_RETRY_DELAY_MS = 50

const RETRYABLE_STATUS_CODES = new Set([502, 503, 504])

type RetryConfig = {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    /** Injectable randomness for deterministic tests. Defaults to `Math.random`. */
    random?: () => number
}

function extractHttpStatusCode(error: unknown): number | undefined {
    if (error === null || error === undefined || typeof error !== 'object') {
        return undefined
    }

    const record = error as Record<string, unknown>

    if (typeof record.httpStatusCode === 'number') {
        return record.httpStatusCode
    }

    if (typeof record.statusCode === 'number') {
        return record.statusCode
    }

    if (typeof record.status === 'number') {
        return record.status
    }

    if (error instanceof Error) {
        const match = error.message.match(/\bHTTP\s+(\d{3})\b/i)
        if (match?.[1]) {
            return Number(match[1])
        }
    }

    return undefined
}

function isTransientError(error: unknown): boolean {
    const statusCode = extractHttpStatusCode(error)
    return statusCode !== undefined && RETRYABLE_STATUS_CODES.has(statusCode)
}

/**
 * Exponential backoff with full jitter: the delay is a random point in
 * `[0, cap]` rather than the cap itself.
 *
 * Without jitter, a batch of requests that all fail together retry in lockstep
 * and hit the server as another simultaneous burst — the same contention that
 * caused the first failure. Spreading the retries is what breaks that cycle.
 */
function getRetryDelay({
    attempt,
    baseDelayMs,
    maxDelayMs,
    random = Math.random,
}: {
    attempt: number
    baseDelayMs: number
    maxDelayMs: number
    random?: () => number
}): number {
    const cap = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
    const jittered = Math.round(random() * cap)
    return Math.min(cap, Math.max(MIN_RETRY_DELAY_MS, jittered))
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function executeWithRetry<T>(fn: () => Promise<T>, config: RetryConfig = {}): Promise<T> {
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    const baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    const maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
    const random = config.random

    let lastError: unknown

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error

            if (attempt < maxRetries && isTransientError(error)) {
                const delay = getRetryDelay({ attempt, baseDelayMs, maxDelayMs, random })
                await sleep(delay)
                continue
            }

            throw error
        }
    }

    throw lastError
}

export {
    executeWithRetry,
    extractHttpStatusCode,
    getRetryDelay,
    isTransientError,
    MIN_RETRY_DELAY_MS,
    type RetryConfig,
}
