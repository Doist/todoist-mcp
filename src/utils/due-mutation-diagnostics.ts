import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Task, UpdateTaskArgs } from '@doist/todoist-sdk'
import packageJson from '../../package.json' with { type: 'json' }
import { ToolNames } from './tool-names.js'

const MAX_BATCHES_PER_MINUTE = 10
const PRE_READ_TIMEOUT_MS = 2000
const MAX_BODY_BYTES = 64 * 1024
const MAX_EVENT_BYTES = 1280
const MAX_REQUEST_IDS = 3

type DiagnosticTool = typeof ToolNames.UPDATE_TASKS | typeof ToolNames.RESCHEDULE_TASKS
type DueState = 'recurring' | 'one_time' | 'none' | 'unknown'
type Flag = boolean | 'unknown' | 'not_applicable'
export type DueMutationResult = 'succeeded' | 'failed' | 'unknown' | 'not_attempted'
type PreReadStatus = 'success' | 'reused' | 'error' | 'timeout' | 'not_attempted'
type WireObservation =
    | 'unobserved'
    | 'observed'
    | 'unsupported_body'
    | 'oversize_body'
    | 'invalid_json'
    | 'command_missing'

type DiagnosticEvent = {
    event: 'todoist_due_mutation_diagnostic'
    level: 'info'
    diagnosticVersion: 1
    mcpVersion: string
    tool: DiagnosticTool
    operationId: string
    taskId: string
    writeStartedAt: string
    writeFinishedAt: string
    requestIds: string[]
    eligibleCount: number
    sampledCount: 1
    preReadStatus: PreReadStatus
    beforeDueState: DueState
    afterDueState: DueState
    requestedMode: 'replace_string' | 'preserve_occurrence'
    explicitClear: boolean
    inputMatchesPriorRule: Flag
    durationSupplied: boolean
    constructedRecurring: Flag
    constructedRuleMatchesBefore: Flag
    wireObservation: WireObservation
    wireRecurring: Flag
    wireRulePresent: Flag
    wireRuleMatchesBefore: Flag
    endpoint: 'task_update' | 'sync' | 'unknown'
    result: DueMutationResult
    httpStatus: number | 'unknown'
    attemptCount: number
    retryCount: number
    moveApplied: Flag
}

export type DueMutationSample<T> = { item: T; index: number; diagnostic: DueMutationDiagnostic }

const writeContext = new AsyncLocalStorage<DueMutationDiagnostic>()
const preReadContext = new AsyncLocalStorage<{ signal: AbortSignal; sent: boolean }>()
type Admission = { finishedAt?: number }
let admissions: Admission[] = []

function enabled(): boolean {
    return process.env.TODOIST_MCP_DUE_DIAGNOSTICS === '1'
}

/** One uniformly selected eligible entry, with a shared rolling per-process budget. */
export function sampleDueMutation<T extends { id: string }>(
    tool: DiagnosticTool,
    eligible: readonly T[],
): DueMutationSample<T> | undefined {
    try {
        if (!enabled() || eligible.length === 0) {
            return undefined
        }
        const now = Date.now()
        // Keep in-flight slots occupied too. Starting the cooldown on settlement
        // prevents queued samples from bursting reads/events when they drain.
        admissions = admissions.filter(
            ({ finishedAt }) => finishedAt === undefined || now - finishedAt < 60_000,
        )
        if (admissions.length >= MAX_BATCHES_PER_MINUTE) {
            return undefined
        }
        const index = Math.floor(Math.random() * eligible.length)
        const item = eligible[index]
        if (!item) {
            return undefined
        }
        const admission: Admission = {}
        const diagnostic = new DueMutationDiagnostic(tool, item.id, eligible.length, () => {
            admission.finishedAt = Date.now()
        })
        admissions.push(admission)
        return { item, index, diagnostic }
    } catch {
        // Diagnostics must never stop a write, including during admission.
        return undefined
    }
}

function dueState(task: Task | undefined): DueState {
    const due = task?.due
    if (due === null) {
        return 'none'
    }
    if (!due || typeof due.isRecurring !== 'boolean') {
        return 'unknown'
    }
    return due.isRecurring ? 'recurring' : 'one_time'
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined
}

/** Holds rule strings only in memory, and drops them when the sampled operation settles. */
class DueMutationDiagnostic {
    private readonly event: DiagnosticEvent
    private beforeRule: string | undefined
    private inputRule: string | null | undefined
    private commandUuid: string | undefined
    private writing = false
    private finished = false

    constructor(
        tool: DiagnosticTool,
        private readonly taskId: string,
        eligibleCount: number,
        private readonly releaseAdmission: () => void,
    ) {
        const preserving = tool === ToolNames.RESCHEDULE_TASKS
        this.event = {
            event: 'todoist_due_mutation_diagnostic',
            level: 'info',
            diagnosticVersion: 1,
            mcpVersion: packageJson.version,
            tool,
            operationId: randomUUID(),
            // IDs follow the batch-failure convention, with malformed or
            // unbounded identifiers redacted rather than emitted as caller text.
            taskId: /^[a-zA-Z0-9_-]{1,64}$/.test(taskId) ? taskId : 'redacted',
            writeStartedAt: 'not_started',
            writeFinishedAt: 'not_started',
            requestIds: [],
            eligibleCount,
            sampledCount: 1,
            preReadStatus: 'not_attempted',
            beforeDueState: 'unknown',
            afterDueState: 'unknown',
            requestedMode: preserving ? 'preserve_occurrence' : 'replace_string',
            explicitClear: false,
            inputMatchesPriorRule: preserving ? 'not_applicable' : 'unknown',
            durationSupplied: false,
            constructedRecurring: preserving ? 'unknown' : 'not_applicable',
            constructedRuleMatchesBefore: preserving ? 'unknown' : 'not_applicable',
            wireObservation: 'unobserved',
            wireRecurring: 'unknown',
            wireRulePresent: 'unknown',
            wireRuleMatchesBefore: 'unknown',
            endpoint: 'unknown',
            result: 'not_attempted',
            httpStatus: 'unknown',
            attemptCount: 0,
            retryCount: 0,
            moveApplied: 'not_applicable',
        }
    }

    private safely(fn: () => void): void {
        if (this.finished) {
            return
        }
        try {
            fn()
        } catch {
            // Never emit raw errors or let diagnostic failures affect a tool.
        }
    }

    private matchesBefore(rule: unknown): Flag {
        if (this.event.beforeDueState === 'none') {
            return 'not_applicable'
        }
        if (typeof this.beforeRule !== 'string' || typeof rule !== 'string') {
            return 'unknown'
        }
        return rule === this.beforeRule
    }

    captureUpdateInput(args: Pick<UpdateTaskArgs, 'dueString' | 'duration'>): void {
        this.safely(() => {
            this.inputRule = args.dueString
            this.event.explicitClear = args.dueString === null || args.dueString === 'no date'
            this.event.durationSupplied = args.duration !== undefined
            this.event.inputMatchesPriorRule = this.matchesBefore(this.inputRule)
        })
    }

    captureBefore(task: Task, status: 'success' | 'reused' = 'success'): void {
        this.safely(() => {
            if (task.id !== this.taskId) {
                this.event.preReadStatus = 'error'
                return
            }
            this.event.preReadStatus = status
            this.event.beforeDueState = dueState(task)
            this.beforeRule = task.due?.string
            if (this.event.requestedMode === 'replace_string') {
                this.event.inputMatchesPriorRule = this.matchesBefore(this.inputRule)
            }
        })
    }

    capturePreReadFailure(status: 'error' | 'timeout' = 'error'): void {
        this.safely(() => {
            this.event.preReadStatus = status
        })
    }

    async readBefore(read: () => Promise<Task>, existing?: Task): Promise<void> {
        if (existing) {
            this.captureBefore(existing, 'reused')
            return
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            const controller = new AbortController()
            const timeout = new Promise<{ status: 'timeout' }>((resolve) => {
                timer = setTimeout(() => {
                    resolve({ status: 'timeout' })
                    controller.abort()
                }, PRE_READ_TIMEOUT_MS)
                timer.unref?.()
            })
            const snapshot = preReadContext.run(
                { signal: controller.signal, sent: false },
                async () => {
                    try {
                        return { status: 'success' as const, task: await read() }
                    } catch {
                        return { status: 'error' as const }
                    }
                },
            )
            // Both resolutions and rejections are handled even if the SDK settles
            // after our timeout. No read result ever feeds the write arguments.
            const result = await Promise.race([snapshot, timeout])
            if (result.status === 'success') {
                this.captureBefore(result.task)
            } else {
                this.capturePreReadFailure(result.status)
            }
        } catch {
            this.capturePreReadFailure()
        } finally {
            clearTimeout(timer)
        }
    }

    captureConstructed(due: { isRecurring?: boolean; string?: string }, commandUuid: string): void {
        this.safely(() => {
            this.commandUuid = commandUuid
            this.event.constructedRecurring = due.isRecurring ?? 'unknown'
            this.event.constructedRuleMatchesBefore = this.matchesBefore(due.string)
        })
    }

    async runWrite<T>(write: () => Promise<T>): Promise<T> {
        this.safely(() => {
            this.event.writeStartedAt = new Date().toISOString()
            this.writing = true
        })
        try {
            // Wrap the actual call and all its retries, not the limiter queue or
            // pre/post reads. Never catch and re-run the caller's write.
            return await writeContext.run(this, write)
        } finally {
            this.safely(() => {
                this.writing = false
                this.event.writeFinishedAt = new Date().toISOString()
            })
        }
    }

    observe(
        url: string,
        options: RequestInit,
        requestId?: string,
    ): ((status: number) => void) | undefined {
        if (!this.writing || this.finished || options.method?.toUpperCase() !== 'POST') {
            return undefined
        }
        const path = new URL(url).pathname
        const taskPath = path.match(/\/tasks\/([^/]+)\/?$/)
        const endpoint =
            this.event.tool === ToolNames.UPDATE_TASKS &&
            taskPath?.[1] &&
            decodeURIComponent(taskPath[1]) === this.taskId
                ? 'task_update'
                : this.event.tool === ToolNames.RESCHEDULE_TASKS && /\/sync\/?$/.test(path)
                  ? 'sync'
                  : undefined
        if (!endpoint) {
            return undefined
        }
        this.safely(() => {
            this.event.endpoint = endpoint
            this.event.attemptCount++
            this.event.retryCount = this.event.attemptCount - 1
            this.event.httpStatus = 'unknown'
            if (requestId && /^[a-f0-9-]{36}$/i.test(requestId)) {
                this.event.requestIds.push(requestId)
                if (this.event.requestIds.length > MAX_REQUEST_IDS) {
                    this.event.requestIds.shift()
                }
            }
            this.inspectBody(options.body, endpoint)
        })
        const attempt = this.event.attemptCount
        return (status) => {
            this.safely(() => {
                if (attempt === this.event.attemptCount && Number.isInteger(status)) {
                    this.event.httpStatus = status
                }
            })
        }
    }

    private inspectBody(body: RequestInit['body'], endpoint: 'task_update' | 'sync'): void {
        this.event.wireObservation = 'unobserved'
        this.event.wireRecurring = 'unknown'
        this.event.wireRulePresent = 'unknown'
        this.event.wireRuleMatchesBefore = 'unknown'
        // Only inspect bounded JSON strings; never read/clone a stream or Request.
        if (typeof body !== 'string') {
            this.event.wireObservation = 'unsupported_body'
            return
        }
        if (body.length > MAX_BODY_BYTES || Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
            this.event.wireObservation = 'oversize_body'
            return
        }
        let payload: Record<string, unknown> | undefined
        try {
            payload = record(JSON.parse(body))
        } catch {
            this.event.wireObservation = 'invalid_json'
            return
        }
        if (!payload) {
            this.event.wireObservation = 'unsupported_body'
            return
        }
        let rule: unknown
        if (endpoint === 'task_update') {
            rule = payload.due_string
            this.event.wireRecurring = 'not_applicable'
        } else {
            const command = Array.isArray(payload.commands)
                ? payload.commands.find((value: unknown) => {
                      const candidate = record(value)
                      return (
                          candidate?.type === 'item_update' &&
                          candidate.uuid === this.commandUuid &&
                          record(candidate.args)?.id === this.taskId
                      )
                  })
                : undefined
            if (!command) {
                this.event.wireObservation = 'command_missing'
                return
            }
            const args = record(record(command)?.args)
            const due = record(args?.due)
            rule = due?.string
            this.event.wireRecurring =
                typeof due?.is_recurring === 'boolean' ? due.is_recurring : 'unknown'
        }
        this.event.wireObservation = 'observed'
        this.event.wireRulePresent = typeof rule === 'string'
        this.event.wireRuleMatchesBefore = this.matchesBefore(rule)
    }

    finish({
        after,
        result,
        moveApplied = 'not_applicable',
    }: {
        after?: Task
        result: DueMutationResult
        moveApplied?: Flag
    }): void {
        this.safely(() => {
            this.event.afterDueState = after?.id === this.taskId ? dueState(after) : 'unknown'
            this.event.result =
                this.event.writeStartedAt === 'not_started' ? 'not_attempted' : result
            this.event.moveApplied = moveApplied
            let line = JSON.stringify(this.event)
            while (
                Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES &&
                this.event.requestIds.length > 0
            ) {
                this.event.requestIds.shift()
                line = JSON.stringify(this.event)
            }
            if (enabled() && Buffer.byteLength(line, 'utf8') <= MAX_EVENT_BYTES) {
                // stderr only: stdout is the stdio MCP protocol transport.
                console.error(line)
            }
        })
        this.safely(this.releaseAdmission)
        this.finished = true
        this.beforeRule = undefined
        this.inputRule = undefined
        this.commandUuid = undefined
    }
}

/** The SDK retries network reads internally; only this optional read gets one send. */
export function claimDueDiagnosticPreReadSignal(): AbortSignal | undefined {
    const context = preReadContext.getStore()
    if (!context) {
        return undefined
    }
    if (context.sent || context.signal.aborted) {
        throw new DOMException('Diagnostic pre-read already sent or expired', 'AbortError')
    }
    context.sent = true
    return context.signal
}

/** Called after SDK serialization. Does nothing outside a sampled write context. */
export function observeDueMutationRequest(
    url: string,
    options: RequestInit,
    requestId?: string,
): ((status: number) => void) | undefined {
    try {
        return enabled() ? writeContext.getStore()?.observe(url, options, requestId) : undefined
    } catch {
        return undefined
    }
}

export function resetDueMutationDiagnosticsForTesting(): void {
    admissions = []
}
