import { LogLimits } from './constants.js'

type BatchFailure = { item: string; error: string; code?: string }

/**
 * Records the items a batch tool could not act on.
 *
 * These failures are reported in the tool result rather than thrown, so the
 * server answers 200 and logs nothing while the caller's items stay untouched.
 * A whole batch can fail on an expired token or a dropped connection with no
 * trace on this side, which leaves nothing to diagnose from afterwards.
 *
 * @param toolName - The tool that ran the batch, for the log prefix.
 * @param total - How many items the caller asked for.
 * @param failures - The items that failed, as reported in the result.
 */
export function logBatchFailures(
    toolName: string,
    total: number,
    failures: ReadonlyArray<BatchFailure>,
): void {
    if (failures.length === 0) {
        return
    }

    console.error(`${toolName}: items failed`, {
        failed: failures.length,
        of: total,
        // A batch is as large as the caller's input, so one outage must not put
        // an unbounded array into a log line.
        sample: failures.slice(0, LogLimits.MAX_FAILURES_LOGGED),
    })
}
