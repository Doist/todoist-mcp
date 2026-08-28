import { logBatchFailures } from './batch-failures.js'
import { LogLimits } from './constants.js'

describe('logBatchFailures', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
    })

    it('reports the failures with their counts', () => {
        logBatchFailures('complete-tasks', 3, [
            { item: '6X4Vw2Hfmg73Q2XR', error: 'HTTP 404: Not Found' },
        ])

        expect(consoleErrorSpy).toHaveBeenCalledWith('complete-tasks: items failed', {
            failed: 1,
            of: 3,
            sample: [{ item: '6X4Vw2Hfmg73Q2XR', error: 'HTTP 404: Not Found' }],
        })
    })

    it('keeps the failure code when the tool reports one', () => {
        logBatchFailures('update-tasks', 1, [
            {
                item: '6X4Vw2Hfmg73Q2XR',
                error: 'Moved, but the update failed',
                code: 'PARTIAL_MOVE_APPLIED',
            },
        ])

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'update-tasks: items failed',
            expect.objectContaining({
                sample: [
                    {
                        item: '6X4Vw2Hfmg73Q2XR',
                        error: 'Moved, but the update failed',
                        code: 'PARTIAL_MOVE_APPLIED',
                    },
                ],
            }),
        )
    })

    it('logs once per batch with a capped sample', () => {
        const failures = Array.from({ length: 200 }, (_, index) => ({
            item: `task-${index}`,
            error: 'HTTP 403: Forbidden',
        }))

        logBatchFailures('add-tasks', 200, failures)

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'add-tasks: items failed',
            expect.objectContaining({
                failed: 200,
                of: 200,
                // Only a sample, so one outage can't put an unbounded array
                // into a log line.
                sample: failures.slice(0, LogLimits.MAX_FAILURES_LOGGED),
            }),
        )
    })

    it('stays quiet when every item succeeds', () => {
        logBatchFailures('complete-tasks', 2, [])

        expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
})
