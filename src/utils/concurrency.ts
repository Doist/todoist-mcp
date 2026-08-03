import { createHash } from 'node:crypto'
import { ConcurrencyLimits } from './constants.js'

/**
 * Wraps a task so it only runs once a slot is free.
 */
type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

type LimiterPair = {
    /** Serialises task-move requests, which contend on server-side tree locks. */
    moves: Limiter
    /** Bounds all other write requests. */
    writes: Limiter
}

/**
 * A FIFO semaphore. Tasks beyond `maxConcurrent` queue and start as slots free up.
 *
 * Deliberately applied at the tool layer rather than inside the SDK's
 * `customFetch`: the SDK installs its request-timeout `AbortSignal` *before*
 * calling `customFetch`, so gating there would charge queue time against the
 * request timeout and fail long-queued requests that never actually ran.
 */
function createLimiter(maxConcurrent: number): Limiter {
    if (maxConcurrent < 1) {
        throw new Error(`maxConcurrent must be at least 1, received ${maxConcurrent}`)
    }

    const queue: Array<() => void> = []
    let active = 0

    async function acquire(): Promise<void> {
        if (active < maxConcurrent) {
            active++
            return
        }
        // A queued task inherits the releasing task's slot, so `active` stays put.
        await new Promise<void>((resolve) => queue.push(resolve))
    }

    function release() {
        const next = queue.shift()
        if (next) {
            next()
            return
        }
        active--
    }

    return async function limit<T>(fn: () => Promise<T>): Promise<T> {
        await acquire()
        try {
            return await fn()
        } finally {
            // Release in `finally` so a rejected task never leaks its slot.
            release()
        }
    }
}

function createLimiterPair(): LimiterPair {
    return {
        moves: createLimiter(ConcurrencyLimits.TASK_MOVES),
        writes: createLimiter(ConcurrencyLimits.WRITES),
    }
}

/**
 * Limiters are keyed by account rather than by client instance because the HTTP
 * transport builds a fresh `TodoistApi` for every request — instance-keyed
 * limiters would let concurrent requests for one account fan out without bound.
 */
const limitersByAccount = new Map<string, LimiterPair>()

/** Lets a tool find its account's limiters from the client it was handed. */
const limitersByClient = new WeakMap<object, LimiterPair>()

/**
 * Catches clients built outside `createTodoistClient` (tests, direct SDK use) so
 * every call site is bounded even when nothing registered it.
 */
let fallbackLimiters: LimiterPair | undefined

function getFallbackLimiters(): LimiterPair {
    fallbackLimiters ??= createLimiterPair()
    return fallbackLimiters
}

/**
 * Derives a stable per-account key. The raw token is never stored — only its
 * digest — so limiter bookkeeping can't leak credentials.
 */
function accountKeyFromApiKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex')
}

/**
 * Associates a client with its account's limiters, sharing one pair across every
 * client built for the same account.
 */
function registerClientLimiters(client: object, apiKey: string): void {
    const key = accountKeyFromApiKey(apiKey)
    let limiters = limitersByAccount.get(key)
    if (!limiters) {
        limiters = createLimiterPair()
        limitersByAccount.set(key, limiters)
    }
    limitersByClient.set(client, limiters)
}

function getLimiters(client: object): LimiterPair {
    return limitersByClient.get(client) ?? getFallbackLimiters()
}

function getMoveLimiter(client: object): Limiter {
    return getLimiters(client).moves
}

function getWriteLimiter(client: object): Limiter {
    return getLimiters(client).writes
}

/** Test-only: drops all registered limiters so cases start from a clean slate. */
function resetLimitersForTesting(): void {
    limitersByAccount.clear()
    fallbackLimiters = undefined
}

export {
    createLimiter,
    getMoveLimiter,
    getWriteLimiter,
    type Limiter,
    registerClientLimiters,
    resetLimitersForTesting,
}
