import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import {
    observeDueMutationRequest,
    resetDueMutationDiagnosticsForTesting,
    sampleDueMutation,
} from './due-mutation-diagnostics.js'
import { createMockTask } from './test-helpers.js'
import { ToolNames } from './tool-names.js'

describe('due mutation diagnostics', () => {
    beforeEach(() => {
        vi.stubEnv('TODOIST_MCP_DUE_DIAGNOSTICS', '1')
        resetDueMutationDiagnosticsForTesting()
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('does not admit or inspect requests when disabled', () => {
        vi.stubEnv('TODOIST_MCP_DUE_DIAGNOSTICS', '')
        const parseSpy = vi.spyOn(JSON, 'parse')
        expect(sampleDueMutation(ToolNames.UPDATE_TASKS, [{ id: 'task-1' }])).toBeUndefined()
        expect(
            observeDueMutationRequest('https://api.todoist.com/api/v1/tasks/task-1', {
                method: 'POST',
                body: 'not JSON',
            }),
        ).toBeUndefined()
        expect(parseSpy).not.toHaveBeenCalled()
        expect(console.error).not.toHaveBeenCalled()
    })

    it('selects one entry across the eligible batch and shares a rolling budget between tools', () => {
        vi.useFakeTimers()
        vi.setSystemTime(0)
        vi.spyOn(Math, 'random').mockReturnValue(0.999)
        const eligible = Array.from({ length: 25 }, (_, index) => ({ id: `task-${index}` }))

        const samples = Array.from({ length: 10 }, (_, index) => {
            const tool = index % 2 ? ToolNames.UPDATE_TASKS : ToolNames.RESCHEDULE_TASKS
            const sample = sampleDueMutation(tool, eligible)
            expect(sample?.index).toBe(24)
            expect(sample?.item).toBe(eligible[24])
            return sample
        })
        // A minute in a limiter queue must not free ten more diagnostic slots.
        vi.setSystemTime(60_000)
        expect(sampleDueMutation(ToolNames.UPDATE_TASKS, eligible)).toBeUndefined()
        for (const sample of samples) {
            sample?.diagnostic.finish({ result: 'not_attempted' })
        }
        expect(console.error).toHaveBeenCalledTimes(10)
        expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0]))).toMatchObject({
            eligibleCount: 25,
            sampledCount: 1,
        })
        vi.setSystemTime(119_999)
        expect(sampleDueMutation(ToolNames.UPDATE_TASKS, eligible)).toBeUndefined()
        vi.setSystemTime(120_000)
        expect(sampleDueMutation(ToolNames.UPDATE_TASKS, eligible)).toBeDefined()
    })

    it('bounds the event and retry IDs without recording content, rules, dates, or transport secrets', async () => {
        const task = createMockTask({
            id: 'a'.repeat(64),
            content: 'PRIVATE_TITLE',
            description: 'PRIVATE_DESCRIPTION',
            due: {
                date: '2037-11-03',
                datetime: '2037-11-03T09:17:00',
                string: 'PRIVATE_RECURRING_RULE',
                timezone: 'PRIVATE_TIMEZONE',
                isRecurring: true,
            },
        })
        const sample = sampleDueMutation(ToolNames.UPDATE_TASKS, [task])
        if (!sample) throw new Error('Expected admission')
        sample.diagnostic.captureUpdateInput({ dueString: task.due?.string, duration: 15 })
        sample.diagnostic.captureBefore(task)
        const requestIds = Array.from({ length: 12 }, () => randomUUID())
        const body = JSON.stringify({
            due_string: task.due?.string,
            content: task.content,
            description: task.description,
            due_datetime: task.due?.datetime,
            calendar: 'PRIVATE_CALENDAR',
        })

        const returned = await sample.diagnostic.runWrite(async () => {
            for (const requestId of requestIds) {
                observeDueMutationRequest(
                    `https://api.todoist.com/api/v1/tasks/${task.id}?secret=PRIVATE_URL`,
                    { method: 'POST', body, headers: { Authorization: 'Bearer PRIVATE_TOKEN' } },
                    requestId,
                )?.(200)
            }
            return task
        })
        sample.diagnostic.finish({ after: returned, result: 'succeeded' })
        // An accidental second finish must not duplicate the result event.
        sample.diagnostic.finish({ result: 'failed' })

        expect(returned).toBe(task)
        expect(console.error).toHaveBeenCalledTimes(1)
        const line = String(vi.mocked(console.error).mock.calls[0]?.[0])
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(1280)
        expect(line).not.toContain('\n')
        expect(line).not.toMatch(/PRIVATE_|2037-11-03/)
        expect(JSON.parse(line)).toMatchObject({
            taskId: task.id,
            beforeDueState: 'recurring',
            afterDueState: 'recurring',
            inputMatchesPriorRule: true,
            wireObservation: 'observed',
            wireRecurring: 'not_applicable',
            wireRulePresent: true,
            wireRuleMatchesBefore: true,
            requestIds: requestIds.slice(-3),
            attemptCount: 12,
            retryCount: 11,
            httpStatus: 200,
        })
    })

    it('does not consume unsupported bodies or parse oversized JSON', async () => {
        const parseSpy = vi.spyOn(JSON, 'parse')
        const bodies = [new Blob(['PRIVATE_BODY']), 'PRIVATE_BODY'.repeat(64 * 1024)]
        for (const body of bodies) {
            const sample = sampleDueMutation(ToolNames.UPDATE_TASKS, [{ id: 'task-1' }])
            if (!sample) throw new Error('Expected admission')
            await sample.diagnostic.runWrite(async () => {
                observeDueMutationRequest('https://api.todoist.com/api/v1/tasks/task-1', {
                    method: 'POST',
                    body,
                })?.(200)
            })
            sample.diagnostic.finish({ result: 'succeeded' })
        }
        expect(parseSpy).not.toHaveBeenCalled()
        const lines = vi.mocked(console.error).mock.calls.map(([line]) => String(line))
        expect(lines).toHaveLength(2)
        expect(lines.map((line) => JSON.parse(line).wireObservation)).toEqual([
            'unsupported_body',
            'oversize_body',
        ])
        for (const line of lines) {
            expect(JSON.parse(line).wireRulePresent).toBe('unknown')
            expect(line).not.toContain('PRIVATE_BODY')
        }
    })
})
