import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { type CustomFetch, type CustomFetchResponse, TodoistApi } from '@doist/todoist-sdk'
import packageJson from '../package.json' with { type: 'json' }

const TODOIST_MCP_NAME = 'todoist-mcp'
const TODOIST_MCP_VERSION = packageJson.version
const toolContext = new AsyncLocalStorage<string>()
const require = createRequire(import.meta.url)

type UsageTrackingConfig = {
    enabled?: boolean
    platform?: string
    sessionId?: string
}

type DispatcherModule = {
    getDefaultDispatcher: () => Promise<unknown | undefined>
}

let defaultDispatcherPromise: Promise<unknown | undefined> | undefined
const defaultDispatcherModuleLoader = async (): Promise<DispatcherModule> => {
    const todoistSdkEntry = require.resolve('@doist/todoist-sdk')
    const dispatcherModulePath = join(dirname(todoistSdkEntry), 'transport', 'http-dispatcher.js')
    return require(dispatcherModulePath) as DispatcherModule
}
let dispatcherModuleLoader = defaultDispatcherModuleLoader

function getUserAgent(): string {
    return `${TODOIST_MCP_NAME}/${TODOIST_MCP_VERSION}`
}

export function normalizeUsageLabel(label: string): string {
    return label.trim().toLowerCase()
}

export function runWithUsageTrackingContext<T>(label: string, fn: () => T): T {
    return toolContext.run(normalizeUsageLabel(label), fn)
}

export function buildUsageTrackingHeaders({
    label,
    platform = 'mcp',
    sessionId = randomUUID(),
}: {
    label?: string
    platform?: string
    sessionId?: string
} = {}): Record<string, string> {
    const normalizedLabel = label ? normalizeUsageLabel(label) : toolContext.getStore()

    return {
        'User-Agent': getUserAgent(),
        'doist-platform': platform,
        'doist-version': TODOIST_MCP_VERSION,
        'request-id': randomUUID(),
        'session-id': sessionId,
        'mcp-tool': normalizedLabel ?? 'unknown',
    }
}

function mergeTodoistHeaders(
    headersInit: HeadersInit | undefined,
    tracking: Required<Pick<UsageTrackingConfig, 'platform' | 'sessionId'>>,
): Record<string, string> {
    const mergedHeaders = new Headers(headersInit)
    for (const [key, value] of Object.entries(buildUsageTrackingHeaders(tracking))) {
        mergedHeaders.set(key, value)
    }
    return Object.fromEntries(mergedHeaders.entries())
}

function getTimeoutAbortReason(): DOMException {
    return new DOMException('The operation was aborted due to timeout', 'TimeoutError')
}

function mergeAbortSignals(
    signal: AbortSignal | null | undefined,
    timeoutMs: number | undefined,
): {
    signal: AbortSignal | undefined
    cleanup: () => void
} {
    if (!signal && timeoutMs === undefined) {
        return {
            signal: undefined,
            cleanup: () => {},
        }
    }

    if (!signal && timeoutMs !== undefined) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(getTimeoutAbortReason()), timeoutMs)
        return {
            signal: controller.signal,
            cleanup: () => clearTimeout(timeoutId),
        }
    }

    if (signal && timeoutMs === undefined) {
        return {
            signal,
            cleanup: () => {},
        }
    }

    const controller = new AbortController()
    const cleanups: Array<() => void> = []

    const abort = (reason: unknown) => {
        if (!controller.signal.aborted) {
            controller.abort(reason)
        }
    }

    if (signal?.aborted) {
        abort(signal.reason)
    } else if (signal) {
        const onAbort = () => abort(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        cleanups.push(() => signal.removeEventListener('abort', onAbort))
    }

    const timeoutId = setTimeout(() => abort(getTimeoutAbortReason()), timeoutMs)
    cleanups.push(() => clearTimeout(timeoutId))

    return {
        signal: controller.signal,
        cleanup: () => {
            for (const cleanup of cleanups) {
                cleanup()
            }
        },
    }
}

async function getSdkDefaultDispatcher(): Promise<unknown | undefined> {
    if (!isNodeEnvironment()) {
        return undefined
    }

    if (!defaultDispatcherPromise) {
        defaultDispatcherPromise = dispatcherModuleLoader()
            .then((dispatcherModule) => dispatcherModule.getDefaultDispatcher())
            .catch((error) => {
                defaultDispatcherPromise = undefined
                throw error
            })
    }

    return defaultDispatcherPromise
}

function isNodeEnvironment(): boolean {
    return typeof process !== 'undefined' && Boolean(process.versions?.node)
}

export async function resetDefaultDispatcherForTests(): Promise<void> {
    if (!defaultDispatcherPromise) {
        return
    }

    const dispatcherPromise = defaultDispatcherPromise
    defaultDispatcherPromise = undefined
    await dispatcherPromise.then(
        (dispatcher) =>
            (dispatcher as { close?: () => void | Promise<void> } | undefined)?.close?.(),
        () => undefined,
    )
}

export function setDispatcherModuleLoaderForTests(loader: () => Promise<DispatcherModule>): void {
    dispatcherModuleLoader = loader
}

export function resetDispatcherModuleLoaderForTests(): void {
    dispatcherModuleLoader = defaultDispatcherModuleLoader
}

async function attachDispatcher(options: RequestInit): Promise<void> {
    const dispatcher = await getSdkDefaultDispatcher()
    if (dispatcher !== undefined) {
        // @ts-expect-error - dispatcher is a valid option for Node's fetch but not in the TS types
        options.dispatcher = dispatcher
    }
}

function toCustomFetchResponse(response: Response): CustomFetchResponse {
    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        text: () => response.text(),
        json: () => response.json(),
        arrayBuffer: () => response.arrayBuffer(),
    }
}

export function createTrackedFetch(
    baseFetch: typeof fetch = globalThis.fetch,
    tracking: UsageTrackingConfig = {},
): CustomFetch {
    // Only attach the EnvHttpProxyAgent dispatcher when running through the
    // real native fetch. Test stubs pass an explicit `baseFetch` and don't
    // need (or understand) the dispatcher option.
    const useDispatcher = baseFetch === globalThis.fetch
    const { enabled = true, platform = 'mcp', sessionId = randomUUID() } = tracking
    return async (url, options = {}) => {
        const { timeout: timeoutMs, headers, signal, ...rest } = options

        const { signal: abortSignal, cleanup } = mergeAbortSignals(signal, timeoutMs)

        try {
            const fetchOptions: RequestInit = {
                ...rest,
                signal: abortSignal,
                ...(enabled
                    ? { headers: mergeTodoistHeaders(headers, { platform, sessionId }) }
                    : headers !== undefined
                      ? { headers }
                      : {}),
            }
            if (useDispatcher) {
                await attachDispatcher(fetchOptions)
            }

            const response = await baseFetch(url, fetchOptions)
            return toCustomFetchResponse(response)
        } finally {
            cleanup()
        }
    }
}

export function createTodoistClient(
    apiKey: string,
    {
        baseUrl,
        tracking,
    }: {
        baseUrl?: string
        tracking?: UsageTrackingConfig
    } = {},
): TodoistApi {
    return new TodoistApi(apiKey, {
        customFetch: createTrackedFetch(globalThis.fetch, tracking),
        ...(baseUrl ? { baseUrl } : {}),
    })
}

export { TODOIST_MCP_VERSION }
