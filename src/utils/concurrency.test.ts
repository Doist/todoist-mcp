import {
    createLimiter,
    getMoveLimiter,
    getWriteLimiter,
    registerClientLimiters,
    resetLimitersForTesting,
} from './concurrency.js'
import { ConcurrencyLimits } from './constants.js'

/**
 * A promise whose resolution the test controls, so it can hold tasks inside the
 * limiter and observe how many are running.
 */
function deferred<T = void>() {
    let resolve: (value: T) => void = () => {}
    let reject: (reason: unknown) => void = () => {}
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

/** Lets queued continuations run without advancing real time. */
function flush() {
    return new Promise((resolve) => setImmediate(resolve))
}

beforeEach(() => {
    resetLimitersForTesting()
})

describe('createLimiter', () => {
    it.each([
        { label: 'zero', value: 0 },
        { label: 'a negative number', value: -1 },
        // Each of these would silently defeat the cap: NaN leaves every task queued,
        // Infinity removes the bound, and a fraction admits an extra task.
        { label: 'NaN', value: Number.NaN },
        { label: 'Infinity', value: Number.POSITIVE_INFINITY },
        { label: 'a fractional limit', value: 1.5 },
    ])('should reject $label', ({ value }) => {
        expect(() => createLimiter(value)).toThrow('maxConcurrent must be a positive integer')
    })

    it('should never exceed the configured concurrency', async () => {
        const limit = createLimiter(2)
        const gates = Array.from({ length: 6 }, () => deferred())
        let active = 0
        let maxActive = 0

        const tasks = gates.map((gate) =>
            limit(async () => {
                active++
                maxActive = Math.max(maxActive, active)
                await gate.promise
                active--
            }),
        )

        await flush()
        expect(maxActive).toBe(2)

        // Release one at a time; each release admits exactly one queued task.
        for (const gate of gates) {
            gate.resolve()
            await flush()
            expect(maxActive).toBe(2)
        }

        await Promise.all(tasks)
        expect(maxActive).toBe(2)
    })

    it('should serialise everything at a limit of 1', async () => {
        const limit = createLimiter(1)
        const gates = Array.from({ length: 3 }, () => deferred())
        let active = 0
        let maxActive = 0

        const tasks = gates.map((gate) =>
            limit(async () => {
                active++
                maxActive = Math.max(maxActive, active)
                await gate.promise
                active--
            }),
        )

        for (const gate of gates) {
            await flush()
            expect(maxActive).toBe(1)
            gate.resolve()
        }

        await Promise.all(tasks)
        expect(maxActive).toBe(1)
    })

    it('should run queued tasks in FIFO order', async () => {
        const limit = createLimiter(1)
        const started: number[] = []
        const gates = Array.from({ length: 4 }, () => deferred())

        const tasks = gates.map((gate, index) =>
            limit(async () => {
                started.push(index)
                await gate.promise
            }),
        )

        for (const gate of gates) {
            await flush()
            gate.resolve()
        }
        await Promise.all(tasks)

        expect(started).toEqual([0, 1, 2, 3])
    })

    it('should release the slot when a task rejects', async () => {
        const limit = createLimiter(1)

        await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

        // A leaked slot would leave this pending forever.
        await expect(limit(() => Promise.resolve('ok'))).resolves.toBe('ok')
    })

    it('should not admit a late arrival into a slot being handed off', async () => {
        const limit = createLimiter(1)
        const first = deferred()
        const second = deferred()
        let active = 0
        let maxActive = 0

        const track = async (gate: Promise<void>) => {
            active++
            maxActive = Math.max(maxActive, active)
            await gate
            active--
        }

        const firstTask = limit(() => track(first.promise))
        const queuedTask = limit(() => track(second.promise))

        await flush()
        // Resolving the first task hands its slot to the queued task. A task
        // arriving in that window must not slip past the limit.
        first.resolve()
        const lateTask = limit(() => track(Promise.resolve()))

        await flush()
        expect(maxActive).toBe(1)

        second.resolve()
        await Promise.all([firstTask, queuedTask, lateTask])
        expect(maxActive).toBe(1)
    })

    it('should return the task result', async () => {
        const limit = createLimiter(1)
        await expect(limit(() => Promise.resolve(42))).resolves.toBe(42)
    })

    describe('queue deadline', () => {
        it('should abandon a task that waits too long, without sending it', async () => {
            vi.useFakeTimers()
            const limit = createLimiter(1, { queueTimeoutMs: 1000 })
            const holding = deferred()
            const ran = vi.fn()

            const held = limit(() => holding.promise)
            const queued = limit(async () => {
                ran()
            })
            const assertion = expect(queued).rejects.toThrow(
                'Timed out after 1000ms waiting for an earlier request to finish; this request was not sent',
            )

            await vi.advanceTimersByTimeAsync(1000)
            await assertion
            // The point of the deadline: the request is never issued.
            expect(ran).not.toHaveBeenCalled()

            holding.resolve()
            await held
            vi.useRealTimers()
        })

        it('should not shrink the pool when a queued task is abandoned', async () => {
            vi.useFakeTimers()
            const limit = createLimiter(1, { queueTimeoutMs: 1000 })
            const holding = deferred()

            const held = limit(() => holding.promise)
            const assertion = expect(limit(() => Promise.resolve('never runs'))).rejects.toThrow(
                'Timed out',
            )
            await vi.advanceTimersByTimeAsync(1000)
            await assertion

            holding.resolve()
            await held

            // A slot handed to an abandoned task would never come back, so this hangs
            // if the timeout left the queue in an inconsistent state.
            vi.useRealTimers()
            await expect(limit(() => Promise.resolve('ok'))).resolves.toBe('ok')
        })

        it('should not abandon a task admitted before its deadline', async () => {
            vi.useFakeTimers()
            const limit = createLimiter(1, { queueTimeoutMs: 1000 })
            const holding = deferred()

            const held = limit(() => holding.promise)
            const queued = limit(() => Promise.resolve('ran'))

            await vi.advanceTimersByTimeAsync(500)
            holding.resolve()
            await held
            await expect(queued).resolves.toBe('ran')

            // A cleared timer must not fire later and reject an already-settled task.
            await vi.advanceTimersByTimeAsync(1000)
            vi.useRealTimers()
        })

        it('should wait indefinitely when the deadline is disabled', async () => {
            vi.useFakeTimers()
            const limit = createLimiter(1, { queueTimeoutMs: 0 })
            const holding = deferred()

            const held = limit(() => holding.promise)
            const queued = limit(() => Promise.resolve('ran'))

            await vi.advanceTimersByTimeAsync(60_000)
            holding.resolve()
            await held
            await expect(queued).resolves.toBe('ran')
            vi.useRealTimers()
        })
    })
})

describe('per-account limiters', () => {
    it('should share limiters across clients registered for the same account', async () => {
        const clientA = {}
        const clientB = {}
        registerClientLimiters(clientA, 'token-1')
        registerClientLimiters(clientB, 'token-1')

        const first = deferred()
        let active = 0
        let maxActive = 0
        const track = async (gate: Promise<void>) => {
            active++
            maxActive = Math.max(maxActive, active)
            await gate
            active--
        }

        const viaA = getMoveLimiter(clientA)(() => track(first.promise))
        const viaB = getMoveLimiter(clientB)(() => track(Promise.resolve()))

        await flush()
        expect(maxActive).toBe(ConcurrencyLimits.TASK_MOVES)

        first.resolve()
        await Promise.all([viaA, viaB])
    })

    it('should keep separate accounts independent', async () => {
        const clientA = {}
        const clientB = {}
        registerClientLimiters(clientA, 'token-1')
        registerClientLimiters(clientB, 'token-2')

        const gateA = deferred()
        let active = 0
        let maxActive = 0
        const track = async (gate: Promise<void>) => {
            active++
            maxActive = Math.max(maxActive, active)
            await gate
            active--
        }

        const viaA = getMoveLimiter(clientA)(() => track(gateA.promise))
        const viaB = getMoveLimiter(clientB)(() => track(Promise.resolve()))

        await flush()
        // Different accounts contend on different trees, so both may run.
        expect(maxActive).toBe(2)

        gateA.resolve()
        await Promise.all([viaA, viaB])
    })

    it('should give moves and writes separate lanes', async () => {
        const client = {}
        registerClientLimiters(client, 'token-1')

        const moveGate = deferred()
        const movePromise = getMoveLimiter(client)(() => moveGate.promise)

        // The move lane is saturated; a write must not be blocked behind it.
        await expect(getWriteLimiter(client)(() => Promise.resolve('written'))).resolves.toBe(
            'written',
        )

        moveGate.resolve()
        await movePromise
    })

    it('should fall back to shared limiters for an unregistered client', async () => {
        const unregistered = {}
        const alsoUnregistered = {}

        const gate = deferred()
        let active = 0
        let maxActive = 0
        const track = async (waitFor: Promise<void>) => {
            active++
            maxActive = Math.max(maxActive, active)
            await waitFor
            active--
        }

        const first = getMoveLimiter(unregistered)(() => track(gate.promise))
        const second = getMoveLimiter(alsoUnregistered)(() => track(Promise.resolve()))

        await flush()
        // Both resolve to the same fallback pair, so nothing is left unbounded.
        expect(maxActive).toBe(ConcurrencyLimits.TASK_MOVES)

        gate.resolve()
        await Promise.all([first, second])
    })
})
