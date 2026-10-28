const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 2000

/**
 * Floor for a jittered delay so a low random draw can't turn a retry into an
 * immediate re-request. Clamped by the computed ceiling, so an explicit
 * zero-delay config (used by tests) still waits nothing.
 */
const MIN_RETRY_DELAY_MS = 50

const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([502, 503, 504])

/**
 * A create that reached the server can have succeeded even when the response is a
 * 502 or 504, and the API has no idempotency key to make a repeat safe, so retrying
 * it could create the item twice. A 503 means the server turned the request away,
 * so that is the only status a create retries.
 */
const CREATE_RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([503])

type RetryConfig = {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    /** Injectable randomness for deterministic tests. Defaults to `Math.random`. */
    random?: () => number
    /** HTTP statuses worth retrying. Defaults to 502, 503 and 504. */
    retryableStatusCodes?: ReadonlySet<number>
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

function isTransientError(
    error: unknown,
    retryableStatusCodes: ReadonlySet<number> = RETRYABLE_STATUS_CODES,
): boolean {
    const statusCode = extractHttpStatusCode(error)
    return statusCode !== undefined && retryableStatusCodes.has(statusCode)
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

            if (attempt < maxRetries && isTransientError(error, config.retryableStatusCodes)) {
                const delay = getRetryDelay({ attempt, baseDelayMs, maxDelayMs, random })
                await sleep(delay)
                continue
            }

            throw error
        }
    }

    throw lastError
}

/**
 * {@link executeWithRetry} for a request that creates something, retrying only the
 * statuses that cannot mean it was already created.
 */
async function executeCreateWithRetry<T>(
    fn: () => Promise<T>,
    config: Omit<RetryConfig, 'retryableStatusCodes'> = {},
): Promise<T> {
    return executeWithRetry(fn, { ...config, retryableStatusCodes: CREATE_RETRYABLE_STATUS_CODES })
}

export {
    executeCreateWithRetry,
    executeWithRetry,
    extractHttpStatusCode,
    getRetryDelay,
    isTransientError,
    MIN_RETRY_DELAY_MS,
    type RetryConfig,
}
