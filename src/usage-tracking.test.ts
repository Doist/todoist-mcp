import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    buildUsageTrackingHeaders,
    createTrackedFetch,
    resetDispatcherModuleLoaderForTests,
    resetDefaultDispatcherForTests,
    setDispatcherModuleLoaderForTests,
    runWithUsageTrackingContext,
} from './usage-tracking.js'

const getDefaultDispatcherMock = vi.fn<() => Promise<unknown | undefined>>(() =>
    Promise.resolve(undefined),
)

function createJsonResponse(body: unknown = { ok: true }): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })
}

describe('usage tracking', () => {
    it('builds mcp tracking headers with tool metadata', () => {
        const headers = runWithUsageTrackingContext('Find-Tasks', () =>
            buildUsageTrackingHeaders({ sessionId: 'session-123' }),
        )

        expect(headers['User-Agent']).toMatch(/^todoist-ai\/\d+\.\d+\.\d+$/)
        expect(headers['doist-platform']).toBe('mcp')
        expect(headers['doist-version']).toMatch(/^\d+\.\d+\.\d+$/)
        expect(headers['request-id']).toBeTruthy()
        expect(headers['session-id']).toBe('session-123')
        expect(headers['mcp-tool']).toBe('find-tasks')
    })

    it('falls back to unknown when no tool context is set', () => {
        expect(buildUsageTrackingHeaders({ sessionId: 'session-123' })['mcp-tool']).toBe('unknown')
    })

    it('injects tracking headers into sdk custom fetch requests', async () => {
        const captured: RequestInit[] = []
        const trackedFetch = createTrackedFetch(
            async (_url, options) => {
                captured.push(options ?? {})
                return createJsonResponse()
            },
            { sessionId: 'session-123' },
        )

        const response = await runWithUsageTrackingContext('find-tasks', async () => {
            await trackedFetch('https://api.todoist.com/api/v1/tasks', {
                method: 'GET',
                headers: { Authorization: 'Bearer token' },
            })

            return trackedFetch('https://api.todoist.com/api/v1/tasks', {
                method: 'GET',
                headers: { Authorization: 'Bearer token' },
            })
        })

        expect(captured).toHaveLength(2)
        const [firstRequest, secondRequest] = captured
        expect(firstRequest).toBeDefined()
        expect(secondRequest).toBeDefined()
        if (!firstRequest || !secondRequest) {
            throw new Error('tracked fetch did not capture both requests')
        }

        const firstHeaders = firstRequest.headers as Record<string, string>
        const secondHeaders = secondRequest.headers as Record<string, string>

        expect(firstHeaders.authorization).toBe('Bearer token')
        expect(firstHeaders['doist-platform']).toBe('mcp')
        expect(firstHeaders['doist-version']).toMatch(/^\d+\.\d+\.\d+$/)
        expect(firstHeaders['mcp-tool']).toBe('find-tasks')
        expect(firstHeaders['session-id']).toBe('session-123')
        expect(firstHeaders['session-id']).toBe(secondHeaders['session-id'])
        expect(firstHeaders['request-id']).not.toBe(secondHeaders['request-id'])
        expect(response.ok).toBe(true)
    })

    it('uses a different session id for separate tracked fetch instances', async () => {
        const capturedSessionIds: string[] = []
        const captureFetch: typeof fetch = async (_url, options) => {
            const headers = new Headers(options?.headers)
            const sessionId = headers.get('session-id')
            if (!sessionId) {
                throw new Error('tracked fetch did not include the session header')
            }
            capturedSessionIds.push(sessionId)
            return createJsonResponse()
        }

        const firstFetch = createTrackedFetch(captureFetch)
        const secondFetch = createTrackedFetch(captureFetch)

        await firstFetch('https://api.todoist.com/api/v1/tasks')
        await secondFetch('https://api.todoist.com/api/v1/tasks')

        expect(capturedSessionIds).toHaveLength(2)
        expect(capturedSessionIds[0]).not.toBe(capturedSessionIds[1])
    })

    it('isolates concurrent tool contexts', async () => {
        const capturedTools: string[] = []
        const trackedFetch = createTrackedFetch(
            async (_url, options) => {
                const headers = options?.headers as Record<string, string>
                const toolName = headers['mcp-tool']
                if (!toolName) {
                    throw new Error('tracked fetch did not include the MCP tool header')
                }
                capturedTools.push(toolName)
                return createJsonResponse()
            },
            { sessionId: 'session-123' },
        )

        await Promise.all([
            runWithUsageTrackingContext('find-tasks', async () => {
                await new Promise((resolve) => setTimeout(resolve, 10))
                await trackedFetch('https://api.todoist.com/api/v1/tasks')
            }),
            runWithUsageTrackingContext('update-tasks', async () => {
                await trackedFetch('https://api.todoist.com/api/v1/tasks')
            }),
        ])

        expect(capturedTools.sort()).toEqual(['find-tasks', 'update-tasks'])
    })

    it('maps sdk timeouts to abort signals', async () => {
        let captured: RequestInit | undefined
        const trackedFetch = createTrackedFetch(
            async (_url, options) => {
                captured = options
                const abortSignal = options?.signal
                return await new Promise<Response>((_resolve, reject) => {
                    if (!(abortSignal instanceof AbortSignal)) {
                        reject(new Error('tracked fetch did not provide an AbortSignal'))
                        return
                    }

                    if (abortSignal.aborted) {
                        reject(abortSignal.reason)
                        return
                    }

                    abortSignal.addEventListener('abort', () => reject(abortSignal.reason), {
                        once: true,
                    })
                })
            },
            { sessionId: 'session-123' },
        )

        await expect(
            trackedFetch('https://api.todoist.com/api/v1/tasks', {
                method: 'GET',
                timeout: 50,
            }),
        ).rejects.toBeInstanceOf(DOMException)

        expect(captured?.signal).toBeInstanceOf(AbortSignal)
        expect(captured?.signal?.aborted).toBe(true)
    })

    describe('proxy dispatcher injection', () => {
        afterEach(async () => {
            getDefaultDispatcherMock.mockReset()
            getDefaultDispatcherMock.mockResolvedValue(undefined)
            await resetDefaultDispatcherForTests()
            resetDispatcherModuleLoaderForTests()
        })

        it('attaches the env proxy dispatcher when createTrackedFetch uses native fetch', async () => {
            const fakeDispatcher = { kind: 'env-http-proxy-agent', close: vi.fn() }
            getDefaultDispatcherMock.mockResolvedValue(fakeDispatcher)
            setDispatcherModuleLoaderForTests(async () => ({
                getDefaultDispatcher: getDefaultDispatcherMock,
            }))

            let captured: RequestInit | undefined
            const originalFetch = globalThis.fetch
            globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
                captured = options
                return createJsonResponse()
            }) as typeof fetch

            try {
                const trackedFetch = createTrackedFetch()
                await trackedFetch('https://api.todoist.com/api/v1/tasks', { method: 'GET' })
            } finally {
                globalThis.fetch = originalFetch
            }

            expect(getDefaultDispatcherMock).toHaveBeenCalled()
            expect(captured).toBeTruthy()
            expect((captured as unknown as { dispatcher?: unknown }).dispatcher).toBe(
                fakeDispatcher,
            )
        })

        it('does not attach a dispatcher when createTrackedFetch is given a stub', async () => {
            let captured: RequestInit | undefined
            const trackedFetch = createTrackedFetch(
                async (_url, options) => {
                    captured = options
                    return createJsonResponse()
                },
                { sessionId: 'session-123' },
            )

            await trackedFetch('https://api.todoist.com/api/v1/tasks', { method: 'GET' })

            expect(getDefaultDispatcherMock).not.toHaveBeenCalled()
            expect(captured).toBeTruthy()
            expect((captured as unknown as { dispatcher?: unknown }).dispatcher).toBeUndefined()
        })
    })

    it('combines sdk timeouts with existing abort signals', async () => {
        const abortController = new AbortController()

        let captured: RequestInit | undefined
        const trackedFetch = createTrackedFetch(
            async (_url, options) => {
                captured = options
                const abortSignal = options?.signal
                return await new Promise<Response>((_resolve, reject) => {
                    if (!(abortSignal instanceof AbortSignal)) {
                        reject(new Error('tracked fetch did not provide an AbortSignal'))
                        return
                    }

                    if (abortSignal.aborted) {
                        reject(abortSignal.reason)
                        return
                    }

                    abortSignal.addEventListener('abort', () => reject(abortSignal.reason), {
                        once: true,
                    })
                })
            },
            { sessionId: 'session-123' },
        )

        const fetchPromise = trackedFetch('https://api.todoist.com/api/v1/tasks', {
            method: 'GET',
            signal: abortController.signal,
            timeout: 250,
        })

        expect(captured?.signal).toBeInstanceOf(AbortSignal)
        expect(captured?.signal).not.toBe(abortController.signal)
        expect(captured?.signal?.aborted).toBe(false)

        abortController.abort()

        await expect(fetchPromise).rejects.toBeDefined()
        expect(captured?.signal?.aborted).toBe(true)
    })

    it('can disable usage tracking for direct helper flows', async () => {
        let captured: RequestInit | undefined
        const trackedFetch = createTrackedFetch(
            async (_url, options) => {
                captured = options
                return createJsonResponse()
            },
            { enabled: false, sessionId: 'session-123' },
        )

        await trackedFetch('https://api.todoist.com/api/v1/tasks', {
            method: 'GET',
            headers: { Authorization: 'Bearer token' },
        })

        const headers = new Headers(captured?.headers)
        expect(headers.get('authorization')).toBe('Bearer token')
        expect(headers.get('doist-platform')).toBeNull()
        expect(headers.get('mcp-tool')).toBeNull()
        expect(headers.get('session-id')).toBeNull()
    })
})
