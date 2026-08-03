import type { TodoistApi } from '@doist/todoist-sdk'
import { vi } from 'vitest'

/**
 * Test-only. Records the API requests a tool makes, so a batch's request behaviour can
 * be asserted rather than inferred.
 *
 * Existing tool tests check what a call *returns*. That leaves the shape of the traffic
 * unverified, which is how this server ended up issuing one `getUser` per task in a
 * batch and firing every move in a batch at once: both looked correct per task, and no
 * test could tell. A backend engineer's dashboard noticed instead of CI.
 *
 * Two properties are worth pinning for any batch tool:
 *
 * - **how many requests** a batch of N items makes. Anything that scales with N when it
 *   needn't is the fan-out this exists to catch.
 * - **how many run at once**, since concurrent writes to the same account contend
 *   server-side.
 */

type Handlers = {
    [K in keyof TodoistApi]?: TodoistApi[K] extends (...args: infer A) => unknown
        ? (...args: A) => unknown
        : never
}

type MethodProfile = {
    /** Requests made to this method. */
    count: number
    /** The most that were ever in flight at once. */
    peak: number
}

type RequestProfile = {
    /** Per-method counts and peak concurrency, for methods that were called. */
    byMethod: Record<string, MethodProfile>
    /** Total requests across every method. */
    total: number
    /** Method names in the order their requests started, e.g. `['getTasks', 'moveTasks']`. */
    sequence: string[]
    count(method: keyof TodoistApi): number
    peak(method: keyof TodoistApi): number
    /** Requests recorded for a method, in call order, with their arguments. */
    argsFor(method: keyof TodoistApi): unknown[][]
    reset(): void
}

/**
 * Builds a mock client whose requests are recorded, alongside the profile to assert on.
 *
 * Handlers return a value (or throw) and the wrapper makes it async, deliberately
 * resolving a macrotask later: a handler that resolves immediately would let each
 * caller finish before the next begins, and every peak would read as 1 no matter how
 * the tool behaves.
 *
 * @example
 * const { client, profile } = createProfilingClient({
 *     updateTask: (id: string) => createMockTask({ id }),
 * })
 * await updateTasks.execute({ tasks: manyTasks }, client)
 * expect(profile.count('updateTask')).toBe(25)
 * expect(profile.peak('updateTask')).toBe(4)
 */
export function createProfilingClient(handlers: Handlers): {
    client: TodoistApi
    profile: RequestProfile
} {
    const records = new Map<string, { count: number; peak: number; inFlight: number }>()
    const sequence: string[] = []
    const argsByMethod = new Map<string, unknown[][]>()

    const record = (method: string) => {
        const entry = records.get(method) ?? { count: 0, peak: 0, inFlight: 0 }
        entry.count++
        entry.inFlight++
        entry.peak = Math.max(entry.peak, entry.inFlight)
        records.set(method, entry)
        sequence.push(method)
    }

    const client = {} as Record<string, unknown>
    for (const [method, handler] of Object.entries(handlers)) {
        client[method] = vi.fn(async (...args: unknown[]) => {
            record(method)
            argsByMethod.set(method, [...(argsByMethod.get(method) ?? []), args])
            try {
                // Yield so concurrent callers all reach the handler before any returns,
                // which is what makes `peak` meaningful.
                await new Promise((resolve) => setImmediate(resolve))
                return (handler as (...handlerArgs: unknown[]) => unknown)(...args)
            } finally {
                const entry = records.get(method)
                if (entry) {
                    entry.inFlight--
                }
            }
        })
    }

    const profile: RequestProfile = {
        get byMethod() {
            return Object.fromEntries(
                [...records].map(([method, { count, peak }]) => [method, { count, peak }]),
            )
        },
        get total() {
            return [...records.values()].reduce((sum, { count }) => sum + count, 0)
        },
        get sequence() {
            return [...sequence]
        },
        count: (method) => records.get(String(method))?.count ?? 0,
        peak: (method) => records.get(String(method))?.peak ?? 0,
        argsFor: (method) => argsByMethod.get(String(method)) ?? [],
        reset: () => {
            records.clear()
            argsByMethod.clear()
            sequence.length = 0
        },
    }

    return { client: client as unknown as TodoistApi, profile }
}

/**
 * Asserts the exact request profile of an operation: every method called, how many
 * times, and how many ran concurrently. Methods absent from `expected` must not have
 * been called at all, so a newly introduced request fails the test rather than slipping
 * in unnoticed.
 *
 * @example
 * expectRequestProfile(profile, {
 *     getTasks: { count: 1, peak: 1 },
 *     moveTasks: { count: 1, peak: 1 },
 * })
 */
export function expectRequestProfile(
    profile: RequestProfile,
    expected: Partial<Record<keyof TodoistApi, { count: number; peak?: number }>>,
): void {
    const actual = profile.byMethod
    const expectedMethods = Object.keys(expected)

    // Compared as whole objects so a failure reports the entire profile, which is far
    // more use than "expected 1, got 2" on a single method.
    expect(Object.keys(actual).toSorted()).toEqual(expectedMethods.toSorted())

    const normalized = Object.fromEntries(
        Object.entries(expected).map(([method, spec]) => [
            method,
            { count: spec?.count ?? 0, peak: spec?.peak ?? actual[method]?.peak ?? 0 },
        ]),
    )
    expect(actual).toEqual(normalized)
}
