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

type QueuedTask = {
    admit: () => void
    abandon: (reason: Error) => void
    timer?: NodeJS.Timeout
}

/**
 * A FIFO semaphore. Tasks beyond `maxConcurrent` queue and start as slots free up.
 *
 * Deliberately applied at the tool layer rather than inside the SDK's
 * `customFetch`: the SDK installs its request-timeout `AbortSignal` *before*
 * calling `customFetch`, so gating there would charge queue time against the
 * request timeout and fail long-queued requests that never actually ran.
 *
 * That same property is why queued tasks need their own deadline. A task's request
 * timeout only starts once it reaches the front of the queue, so without one a task
 * can wait indefinitely — long past the point its caller gave up — and then still
 * issue its request. `queueTimeoutMs` bounds the wait instead, failing the task with
 * a reason that says the request was never sent.
 */
function createLimiter(
    maxConcurrent: number,
    { queueTimeoutMs = ConcurrencyLimits.QUEUE_WAIT_MS }: { queueTimeoutMs?: number } = {},
): Limiter {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
        throw new Error(
            `maxConcurrent must be a positive integer, received ${String(maxConcurrent)}`,
        )
    }

    const queue: QueuedTask[] = []
    let active = 0

    async function acquire(): Promise<void> {
        if (active < maxConcurrent) {
            active++
            return
        }

        // A queued task inherits the releasing task's slot, so `active` stays put.
        await new Promise<void>((resolve, reject) => {
            const queued: QueuedTask = { admit: resolve, abandon: reject }
            queue.push(queued)

            if (queueTimeoutMs <= 0) {
                return
            }

            queued.timer = setTimeout(() => {
                // Drop it from the queue first: a slot handed to an abandoned task
                // would never be released, shrinking the pool for good.
                const position = queue.indexOf(queued)
                if (position !== -1) {
                    queue.splice(position, 1)
                }
                queued.abandon(
                    new Error(
                        `Timed out after ${queueTimeoutMs}ms waiting for an earlier request to finish; this request was not sent`,
                    ),
                )
            }, queueTimeoutMs)
            // Never keep the process alive purely to time out a queued task.
            queued.timer.unref?.()
        })
    }

    function release() {
        const next = queue.shift()
        if (next) {
            clearTimeout(next.timer)
            next.admit()
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
