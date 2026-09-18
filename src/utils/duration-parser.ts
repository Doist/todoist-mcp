/**
 * Duration parser utility for converting human-readable duration strings
 * to the `{ amount, unit }` shape the Todoist API stores, using a
 * restricted, language-neutral syntax.
 *
 * Supported formats:
 * - "2h" (hours only)
 * - "90m" (minutes only)
 * - "2h30m" (hours + minutes)
 * - "1.5h" (decimal hours)
 * - "3d" (whole days; the API's `day` unit, which cannot be mixed with h/m)
 * - Supports optional spaces: "2h 30m"
 *
 * There is deliberately no upper bound here. The API accepts minute durations
 * of 24 hours or longer and day-based durations; the Todoist apps only display
 * durations under 24 hours, but that is a product limit of the apps, not of
 * the API this server talks to.
 */

import type { DurationUnit } from '@doist/todoist-sdk'

type ParsedDuration = {
    amount: number
    unit: DurationUnit
}

export const DURATION_INPUT_DESCRIPTION =
    'The duration of the task. Use format: "2h" (hours), "90m" (minutes), "2h30m" (combined), "1.5h" (decimal hours), or "3d" (whole days; days cannot be combined with hours or minutes). Todoist apps only display durations under 24 hours: a longer or day-based duration is stored and reported by this server, but the apps show the task as having no duration.'

const FORMAT_HINT = 'Use format like "2h", "30m", "2h30m", "1.5h", or "3d"'

export class DurationParseError extends Error {
    constructor(input: string, reason: string) {
        super(`Invalid duration format "${input}": ${reason}`)
        this.name = 'DurationParseError'
    }
}

/**
 * Parses a duration string in the restricted syntax into the amount and unit
 * the API stores: whole days for "3d", otherwise minutes.
 *
 * @param durationStr - Duration string like "2h30m", "45m", "1.5h", "3d"
 * @returns Parsed duration amount and unit
 * @throws DurationParseError for invalid formats
 */
export function parseDuration(durationStr: string): ParsedDuration {
    if (!durationStr || typeof durationStr !== 'string') {
        throw new DurationParseError(durationStr, 'Duration must be a non-empty string')
    }

    // Remove all spaces and convert to lowercase
    const normalized = durationStr.trim().toLowerCase().replace(/\s+/g, '')

    // Check for empty string after trimming
    if (!normalized) {
        throw new DurationParseError(durationStr, 'Duration must be a non-empty string')
    }

    // Days stand alone: the API stores a single unit, so "1d2h" has no representation
    const daysStr = normalized.match(/^(\d+(?:\.\d+)?)d$/)?.[1]
    if (daysStr !== undefined) {
        return { amount: parseDays(durationStr, daysStr), unit: 'day' }
    }
    if (mixesDaysWithHoursOrMinutes(normalized)) {
        throw new DurationParseError(
            durationStr,
            `${FORMAT_HINT} (days cannot be combined with hours or minutes)`,
        )
    }

    return { amount: parseMinutes(durationStr, normalized), unit: 'minute' }
}

/** True for well-formed unit sequences such as "1d2h" or "2h1d" that use days alongside h/m. */
function mixesDaysWithHoursOrMinutes(normalized: string): boolean {
    const wellFormed = /^(?:\d+(?:\.\d+)?[dhm])+$/.test(normalized)
    return wellFormed && /d/.test(normalized) && /[hm]/.test(normalized)
}

function parseDays(durationStr: string, daysStr: string): number {
    const days = Number.parseFloat(daysStr)
    if (Number.isNaN(days) || days < 0) {
        throw new DurationParseError(durationStr, 'Days must be a positive number')
    }
    if (days % 1 !== 0) {
        throw new DurationParseError(durationStr, 'Days must be a whole number')
    }
    if (days === 0) {
        throw new DurationParseError(durationStr, 'Duration must be at least 1 day')
    }
    return days
}

function parseMinutes(durationStr: string, normalized: string): number {
    // Validate format with strict ordering: hours must come before minutes
    // This regex ensures: optional hours followed by optional minutes, no duplicates
    const match = normalized.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/)
    if (!match || (!match[1] && !match[2])) {
        throw new DurationParseError(durationStr, FORMAT_HINT)
    }

    let totalMinutes = 0
    const [, hoursStr, minutesStr] = match

    // Parse hours if present
    if (hoursStr) {
        const hours = Number.parseFloat(hoursStr)
        if (Number.isNaN(hours) || hours < 0) {
            throw new DurationParseError(durationStr, 'Hours must be a positive number')
        }
        totalMinutes += hours * 60
    }

    // Parse minutes if present
    if (minutesStr) {
        const minutes = Number.parseFloat(minutesStr)
        if (Number.isNaN(minutes) || minutes < 0) {
            throw new DurationParseError(durationStr, 'Minutes must be a positive number')
        }
        // Don't allow decimal minutes
        if (minutes % 1 !== 0) {
            throw new DurationParseError(
                durationStr,
                'Minutes must be a whole number (use decimal hours instead)',
            )
        }
        totalMinutes += minutes
    }

    // The regex already ensures at least one unit is present

    // Round to nearest minute (handles decimal hours)
    totalMinutes = Math.round(totalMinutes)

    // Validate minimum duration
    if (totalMinutes === 0) {
        throw new DurationParseError(durationStr, 'Duration must be greater than 0 minutes')
    }

    return totalMinutes
}

/**
 * Formats a stored duration back to a human-readable string.
 * Used when returning task data to LLMs.
 *
 * The output mirrors the stored unit so it round-trips through `parseDuration`:
 * day durations become "3d", and minute durations always use hours/minutes
 * ("48h", never "2d") so a day-based and a minute-based duration stay
 * distinguishable.
 *
 * @param amount - Duration amount in the given unit
 * @param unit - The unit the amount is stored in
 * @returns Formatted duration string like "2h30m", "45m" or "3d"
 */
export function formatDuration(amount: number, unit: DurationUnit = 'minute'): string {
    if (unit === 'day') {
        return `${amount}d`
    }

    if (amount <= 0) return '0m'

    const hours = Math.floor(amount / 60)
    const remainingMinutes = amount % 60

    if (hours === 0) {
        return `${remainingMinutes}m`
    }

    if (remainingMinutes === 0) {
        return `${hours}h`
    }

    return `${hours}h${remainingMinutes}m`
}
