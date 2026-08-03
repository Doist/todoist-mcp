import {
    executeWithRetry,
    extractHttpStatusCode,
    getRetryDelay,
    isTransientError,
    MIN_RETRY_DELAY_MS,
} from './retry.js'

const NO_DELAY: { baseDelayMs: number; maxDelayMs: number } = {
    baseDelayMs: 0,
    maxDelayMs: 0,
}

describe('extractHttpStatusCode', () => {
    it('should extract httpStatusCode from TodoistRequestError shape', () => {
        const error = { httpStatusCode: 503, message: 'Service Unavailable' }
        expect(extractHttpStatusCode(error)).toBe(503)
    })

    it('should extract statusCode property', () => {
        const error = { statusCode: 502 }
        expect(extractHttpStatusCode(error)).toBe(502)
    })

    it('should extract status property', () => {
        const error = { status: 504 }
        expect(extractHttpStatusCode(error)).toBe(504)
    })

    it('should extract status code from Error message', () => {
        const error = new Error('HTTP 503: Service Unavailable')
        expect(extractHttpStatusCode(error)).toBe(503)
    })

    it('should return undefined for null', () => {
        expect(extractHttpStatusCode(null)).toBeUndefined()
    })

    it('should return undefined for undefined', () => {
        expect(extractHttpStatusCode(undefined)).toBeUndefined()
    })

    it('should return undefined for non-object', () => {
        expect(extractHttpStatusCode('string error')).toBeUndefined()
    })

    it('should return undefined for object without status code', () => {
        expect(extractHttpStatusCode({ message: 'Something went wrong' })).toBeUndefined()
    })

    it('should return undefined for Error without status in message', () => {
        const error = new Error('Something went wrong')
        expect(extractHttpStatusCode(error)).toBeUndefined()
    })

    it('should prefer httpStatusCode over statusCode', () => {
        const error = { httpStatusCode: 503, statusCode: 400 }
        expect(extractHttpStatusCode(error)).toBe(503)
    })
})

describe('isTransientError', () => {
    it('should return true for 502 Bad Gateway', () => {
        expect(isTransientError({ httpStatusCode: 502 })).toBe(true)
    })

    it('should return true for 503 Service Unavailable', () => {
        expect(isTransientError({ httpStatusCode: 503 })).toBe(true)
    })

    it('should return true for 504 Gateway Timeout', () => {
        expect(isTransientError({ httpStatusCode: 504 })).toBe(true)
    })

    it('should return false for 500 Internal Server Error', () => {
        expect(isTransientError({ httpStatusCode: 500 })).toBe(false)
    })

    it('should return false for 400 Bad Request', () => {
        expect(isTransientError({ httpStatusCode: 400 })).toBe(false)
    })

    it('should return false for 401 Unauthorized', () => {
        expect(isTransientError({ httpStatusCode: 401 })).toBe(false)
    })

    it('should return false for 404 Not Found', () => {
        expect(isTransientError({ httpStatusCode: 404 })).toBe(false)
    })

    it('should return false for 429 Too Many Requests', () => {
        expect(isTransientError({ httpStatusCode: 429 })).toBe(false)
    })

    it('should return false for errors without status code', () => {
        expect(isTransientError(new Error('Unknown error'))).toBe(false)
    })

    it('should return false for null', () => {
        expect(isTransientError(null)).toBe(false)
    })

    it('should detect transient error from message', () => {
        expect(isTransientError(new Error('HTTP 503: Service Unavailable'))).toBe(true)
    })
})

describe('executeWithRetry', () => {
    it('should return result on first successful attempt', async () => {
        const fn = vi.fn().mockResolvedValue('success')

        const result = await executeWithRetry(fn, NO_DELAY)

        expect(result).toBe('success')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on 503 and succeed on second attempt', async () => {
        const error503 = Object.assign(new Error('HTTP 503: Service Unavailable'), {
            httpStatusCode: 503,
        })
        const fn = vi.fn().mockRejectedValueOnce(error503).mockResolvedValue('success')

        const result = await executeWithRetry(fn, NO_DELAY)

        expect(result).toBe('success')
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should retry on 502 and succeed on third attempt', async () => {
        const error502 = Object.assign(new Error('HTTP 502: Bad Gateway'), {
            httpStatusCode: 502,
        })
        const fn = vi
            .fn()
            .mockRejectedValueOnce(error502)
            .mockRejectedValueOnce(error502)
            .mockResolvedValue('success')

        const result = await executeWithRetry(fn, NO_DELAY)

        expect(result).toBe('success')
        expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should throw after exhausting all retries on persistent 503', async () => {
        const error503 = Object.assign(new Error('HTTP 503: Service Unavailable'), {
            httpStatusCode: 503,
        })
        const fn = vi.fn().mockRejectedValue(error503)

        await expect(executeWithRetry(fn, NO_DELAY)).rejects.toThrow(
            'HTTP 503: Service Unavailable',
        )
        expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should not retry on 400 Bad Request', async () => {
        const error400 = Object.assign(new Error('HTTP 400: Bad Request'), {
            httpStatusCode: 400,
        })
        const fn = vi.fn().mockRejectedValue(error400)

        await expect(executeWithRetry(fn, NO_DELAY)).rejects.toThrow('HTTP 400: Bad Request')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should not retry on 401 Unauthorized', async () => {
        const error401 = Object.assign(new Error('HTTP 401: Unauthorized'), {
            httpStatusCode: 401,
        })
        const fn = vi.fn().mockRejectedValue(error401)

        await expect(executeWithRetry(fn, NO_DELAY)).rejects.toThrow('HTTP 401: Unauthorized')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should not retry on 404 Not Found', async () => {
        const error404 = Object.assign(new Error('HTTP 404: Not Found'), {
            httpStatusCode: 404,
        })
        const fn = vi.fn().mockRejectedValue(error404)

        await expect(executeWithRetry(fn, NO_DELAY)).rejects.toThrow('HTTP 404: Not Found')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should not retry on 500 Internal Server Error', async () => {
        const error500 = Object.assign(new Error('HTTP 500: Internal Server Error'), {
            httpStatusCode: 500,
        })
        const fn = vi.fn().mockRejectedValue(error500)

        await expect(executeWithRetry(fn, NO_DELAY)).rejects.toThrow(
            'HTTP 500: Internal Server Error',
        )
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should not retry on non-HTTP errors', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('Network failure'))

        await expect(executeWithRetry(fn, NO_DELAY)).rejects.toThrow('Network failure')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on 504 Gateway Timeout', async () => {
        const error504 = Object.assign(new Error('HTTP 504: Gateway Timeout'), {
            httpStatusCode: 504,
        })
        const fn = vi.fn().mockRejectedValueOnce(error504).mockResolvedValue('recovered')

        const result = await executeWithRetry(fn, NO_DELAY)

        expect(result).toBe('recovered')
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should respect custom maxRetries config', async () => {
        const error503 = Object.assign(new Error('HTTP 503: Service Unavailable'), {
            httpStatusCode: 503,
        })
        const fn = vi.fn().mockRejectedValue(error503)

        await expect(executeWithRetry(fn, { maxRetries: 1, ...NO_DELAY })).rejects.toThrow(
            'HTTP 503: Service Unavailable',
        )
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('should use exponential backoff delays, drawing up to the ceiling', async () => {
        vi.useFakeTimers()

        const error503 = Object.assign(new Error('HTTP 503: Service Unavailable'), {
            httpStatusCode: 503,
        })
        const fn = vi.fn().mockRejectedValueOnce(error503).mockResolvedValue('recovered')
        const sleepSpy = vi.spyOn(globalThis, 'setTimeout')

        // random: () => 1 draws the top of the jitter range, making the ceiling exact
        const promise = executeWithRetry(fn, {
            baseDelayMs: 500,
            maxDelayMs: 2000,
            random: () => 1,
        })
        await vi.advanceTimersByTimeAsync(500)
        const result = await promise

        expect(result).toBe('recovered')

        const retryDelays = sleepSpy.mock.calls
            .filter(([, delay]) => typeof delay === 'number' && delay >= 500)
            .map(([, delay]) => delay)

        expect(retryDelays).toContain(500)

        vi.useRealTimers()
    })

    it('should cap delay at maxDelayMs', async () => {
        vi.useFakeTimers()

        const error503 = Object.assign(new Error('HTTP 503: Service Unavailable'), {
            httpStatusCode: 503,
        })
        const fn = vi
            .fn()
            .mockRejectedValueOnce(error503)
            .mockRejectedValueOnce(error503)
            .mockResolvedValue('recovered')
        const sleepSpy = vi.spyOn(globalThis, 'setTimeout')

        const promise = executeWithRetry(fn, {
            baseDelayMs: 1000,
            maxDelayMs: 1500,
            random: () => 1,
        })
        await vi.advanceTimersByTimeAsync(1000)
        await vi.advanceTimersByTimeAsync(1500)
        const result = await promise

        expect(result).toBe('recovered')

        const retryDelays = sleepSpy.mock.calls
            .filter(([, delay]) => typeof delay === 'number' && delay >= 1000)
            .map(([, delay]) => delay)

        expect(retryDelays).toContain(1000)
        expect(retryDelays).toContain(1500)
        expect(retryDelays).not.toContain(2000)

        vi.useRealTimers()
    })

    it('should spread concurrent retries instead of retrying in lockstep', async () => {
        vi.useFakeTimers()

        const error503 = Object.assign(new Error('HTTP 503: Service Unavailable'), {
            httpStatusCode: 503,
        })
        const makeFn = () => vi.fn().mockRejectedValueOnce(error503).mockResolvedValue('recovered')
        const sleepSpy = vi.spyOn(globalThis, 'setTimeout')

        const first = executeWithRetry(makeFn(), {
            baseDelayMs: 1000,
            maxDelayMs: 2000,
            random: () => 0.25,
        })
        const second = executeWithRetry(makeFn(), {
            baseDelayMs: 1000,
            maxDelayMs: 2000,
            random: () => 0.75,
        })

        await vi.advanceTimersByTimeAsync(1000)
        await Promise.all([first, second])

        const retryDelays = sleepSpy.mock.calls
            .filter(([, delay]) => typeof delay === 'number' && delay >= MIN_RETRY_DELAY_MS)
            .map(([, delay]) => delay)

        expect(retryDelays).toContain(250)
        expect(retryDelays).toContain(750)

        vi.useRealTimers()
    })
})

describe('getRetryDelay', () => {
    const CONFIG = { baseDelayMs: 500, maxDelayMs: 2000 }

    it('should return the full ceiling on the highest draw', () => {
        expect(getRetryDelay({ attempt: 0, ...CONFIG, random: () => 1 })).toBe(500)
        expect(getRetryDelay({ attempt: 1, ...CONFIG, random: () => 1 })).toBe(1000)
        expect(getRetryDelay({ attempt: 2, ...CONFIG, random: () => 1 })).toBe(2000)
    })

    it('should never return the ceiling when the draw is lower', () => {
        expect(getRetryDelay({ attempt: 1, ...CONFIG, random: () => 0.5 })).toBe(500)
    })

    it('should floor a low draw at MIN_RETRY_DELAY_MS so retries are not immediate', () => {
        expect(getRetryDelay({ attempt: 0, ...CONFIG, random: () => 0 })).toBe(MIN_RETRY_DELAY_MS)
    })

    it('should honour an explicit zero-delay config over the floor', () => {
        expect(getRetryDelay({ attempt: 0, baseDelayMs: 0, maxDelayMs: 0, random: () => 1 })).toBe(
            0,
        )
    })

    it('should stay within [MIN_RETRY_DELAY_MS, ceiling] across many draws', () => {
        const draws = Array.from({ length: 50 }, (_, index) => index / 50)
        for (const draw of draws) {
            const delay = getRetryDelay({ attempt: 1, ...CONFIG, random: () => draw })
            expect(delay).toBeGreaterThanOrEqual(MIN_RETRY_DELAY_MS)
            expect(delay).toBeLessThanOrEqual(1000)
        }
    })

    it('should produce different delays for different draws', () => {
        const delays = new Set(
            [0.1, 0.4, 0.9].map((draw) =>
                getRetryDelay({ attempt: 2, ...CONFIG, random: () => draw }),
            ),
        )
        expect(delays.size).toBe(3)
    })

    it('should use default config when none provided', async () => {
        const fn = vi.fn().mockResolvedValue('success')

        const result = await executeWithRetry(fn)

        expect(result).toBe('success')
        expect(fn).toHaveBeenCalledTimes(1)
    })
})
