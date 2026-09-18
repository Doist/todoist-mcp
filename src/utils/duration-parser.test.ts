import { DurationParseError, formatDuration, parseDuration } from './duration-parser.js'

describe('parseDuration', () => {
    describe('valid formats', () => {
        it('should parse hours only', () => {
            expect(parseDuration('2h')).toEqual({ amount: 120, unit: 'minute' })
            expect(parseDuration('1h')).toEqual({ amount: 60, unit: 'minute' })
            expect(parseDuration('24h')).toEqual({ amount: 1440, unit: 'minute' })
        })

        it('should parse minutes only', () => {
            expect(parseDuration('90m')).toEqual({ amount: 90, unit: 'minute' })
            expect(parseDuration('45m')).toEqual({ amount: 45, unit: 'minute' })
            expect(parseDuration('1m')).toEqual({ amount: 1, unit: 'minute' })
            expect(parseDuration('1440m')).toEqual({ amount: 1440, unit: 'minute' })
        })

        it('should parse hours and minutes combined', () => {
            expect(parseDuration('2h30m')).toEqual({ amount: 150, unit: 'minute' })
            expect(parseDuration('1h45m')).toEqual({ amount: 105, unit: 'minute' })
            expect(parseDuration('0h30m')).toEqual({ amount: 30, unit: 'minute' })
            expect(parseDuration('23h59m')).toEqual({ amount: 1439, unit: 'minute' })
        })

        it('should parse decimal hours', () => {
            expect(parseDuration('1.5h')).toEqual({ amount: 90, unit: 'minute' })
            expect(parseDuration('2.25h')).toEqual({ amount: 135, unit: 'minute' })
            expect(parseDuration('0.5h')).toEqual({ amount: 30, unit: 'minute' })
            expect(parseDuration('0.75h')).toEqual({ amount: 45, unit: 'minute' })
        })

        it('should handle spaces in input', () => {
            expect(parseDuration('2h 30m')).toEqual({ amount: 150, unit: 'minute' })
            expect(parseDuration(' 1h45m ')).toEqual({ amount: 105, unit: 'minute' })
            expect(parseDuration('  2h  ')).toEqual({ amount: 120, unit: 'minute' })
            expect(parseDuration(' 90m ')).toEqual({ amount: 90, unit: 'minute' })
        })

        it('should handle case insensitive input', () => {
            expect(parseDuration('2H')).toEqual({ amount: 120, unit: 'minute' })
            expect(parseDuration('90M')).toEqual({ amount: 90, unit: 'minute' })
            expect(parseDuration('2H30M')).toEqual({ amount: 150, unit: 'minute' })
            expect(parseDuration('1.5H')).toEqual({ amount: 90, unit: 'minute' })
        })

        it('should round decimal minutes from decimal hours', () => {
            expect(parseDuration('1.33h')).toEqual({ amount: 80, unit: 'minute' }) // 1.33 * 60 = 79.8 -> 80
            expect(parseDuration('1.67h')).toEqual({ amount: 100, unit: 'minute' }) // 1.67 * 60 = 100.2 -> 100
        })

        it('should accept minute durations of 24 hours or longer', () => {
            expect(parseDuration('25h')).toEqual({ amount: 1500, unit: 'minute' })
            expect(parseDuration('1441m')).toEqual({ amount: 1441, unit: 'minute' })
            expect(parseDuration('24h1m')).toEqual({ amount: 1441, unit: 'minute' })
            expect(parseDuration('24.1h')).toEqual({ amount: 1446, unit: 'minute' })
            expect(parseDuration('48h')).toEqual({ amount: 2880, unit: 'minute' })
        })
    })

    describe('day durations', () => {
        it('should parse whole days as the day unit', () => {
            expect(parseDuration('3d')).toEqual({ amount: 3, unit: 'day' })
            expect(parseDuration('1d')).toEqual({ amount: 1, unit: 'day' })
            expect(parseDuration('30d')).toEqual({ amount: 30, unit: 'day' })
        })

        it('should handle spaces and case', () => {
            expect(parseDuration('1D')).toEqual({ amount: 1, unit: 'day' })
            expect(parseDuration(' 3 d ')).toEqual({ amount: 3, unit: 'day' })
        })

        it('should reject decimal days', () => {
            expect(() => parseDuration('1.5d')).toThrow('Days must be a whole number')
        })

        it('should reject zero days', () => {
            expect(() => parseDuration('0d')).toThrow('Duration must be at least 1 day')
        })

        it('should reject days combined with hours or minutes', () => {
            const reason = 'days cannot be combined with hours or minutes'
            expect(() => parseDuration('1d2h')).toThrow(reason)
            expect(() => parseDuration('2h1d')).toThrow(reason)
            expect(() => parseDuration('1d30m')).toThrow(reason)
            expect(() => parseDuration('1d 2h 30m')).toThrow(reason)
        })

        it('should reject duplicate day units with the generic hint', () => {
            expect(() => parseDuration('3d3d')).toThrow(DurationParseError)
            expect(() => parseDuration('3d3d')).not.toThrow('cannot be combined')
        })
    })

    describe('invalid formats', () => {
        it('should throw error for empty or null input', () => {
            expect(() => parseDuration('')).toThrow(DurationParseError)
            expect(() => parseDuration('   ')).toThrow('Duration must be a non-empty string')
            // oxlint-disable-next-line @typescript-eslint/no-explicit-any -- Testing error cases with invalid types
            expect(() => parseDuration(null as any)).toThrow('Duration must be a non-empty string')
            // oxlint-disable-next-line @typescript-eslint/no-explicit-any -- Testing error cases with invalid types
            expect(() => parseDuration(undefined as any)).toThrow(
                'Duration must be a non-empty string',
            )
        })

        it('should throw error for invalid format', () => {
            expect(() => parseDuration('2')).toThrow(
                'Use format like "2h", "30m", "2h30m", "1.5h", or "3d"',
            )
            expect(() => parseDuration('invalid')).toThrow(
                'Invalid duration format "invalid": Use format like "2h", "30m", "2h30m", "1.5h", or "3d"',
            )
            expect(() => parseDuration('2hours')).toThrow('Use format like')
            expect(() => parseDuration('2h30')).toThrow('Use format like')
            expect(() => parseDuration('h30m')).toThrow('Use format like')
            expect(() => parseDuration('2x30m')).toThrow('Use format like')
            expect(() => parseDuration('2h30s')).toThrow('Use format like')
        })

        it('should throw error for decimal minutes', () => {
            expect(() => parseDuration('90.5m')).toThrow('Minutes must be a whole number')
            expect(() => parseDuration('1h30.5m')).toThrow('Minutes must be a whole number')
        })

        it('should throw error for negative values', () => {
            expect(() => parseDuration('-2h')).toThrow('Use format like')
            expect(() => parseDuration('-30m')).toThrow('Use format like')
            expect(() => parseDuration('2h-30m')).toThrow('Use format like')
        })

        it('should throw error for zero duration', () => {
            expect(() => parseDuration('0h')).toThrow('Duration must be greater than 0 minutes')
            expect(() => parseDuration('0m')).toThrow('Duration must be greater than 0 minutes')
            expect(() => parseDuration('0h0m')).toThrow('Duration must be greater than 0 minutes')
        })

        it('should throw error for malformed numbers', () => {
            expect(() => parseDuration('2.h')).toThrow('Use format like')
            expect(() => parseDuration('2h.m')).toThrow('Use format like')
            expect(() => parseDuration('2..5h')).toThrow('Use format like')
        })

        it('should throw error for duplicate units', () => {
            expect(() => parseDuration('2h3h')).toThrow('Use format like')
            expect(() => parseDuration('30m45m')).toThrow('Use format like')
        })

        it('should throw error for wrong order (minutes before hours)', () => {
            expect(() => parseDuration('30m2h')).toThrow('Use format like')
            expect(() => parseDuration('45m1h')).toThrow('Use format like')
        })

        it('should throw error for invalid mixed formats with correct order', () => {
            expect(() => parseDuration('2h30m15h')).toThrow('Use format like')
            expect(() => parseDuration('1h2h30m')).toThrow('Use format like')
        })
    })

    describe('edge cases', () => {
        it('should treat exactly 24 hours as minutes', () => {
            expect(parseDuration('24h')).toEqual({ amount: 1440, unit: 'minute' })
            expect(parseDuration('1440m')).toEqual({ amount: 1440, unit: 'minute' })
            expect(parseDuration('23h60m')).toEqual({ amount: 1440, unit: 'minute' })
        })

        it('should handle minimum allowed duration', () => {
            expect(parseDuration('1m')).toEqual({ amount: 1, unit: 'minute' })
            expect(parseDuration('0.017h')).toEqual({ amount: 1, unit: 'minute' }) // 0.017 * 60 = 1.02 -> 1
        })
    })
})

describe('formatDuration', () => {
    it('should format minutes only', () => {
        expect(formatDuration(45)).toBe('45m')
        expect(formatDuration(1)).toBe('1m')
        expect(formatDuration(59)).toBe('59m')
    })

    it('should format hours only', () => {
        expect(formatDuration(60)).toBe('1h')
        expect(formatDuration(120)).toBe('2h')
        expect(formatDuration(1440)).toBe('24h')
    })

    it('should format hours and minutes combined', () => {
        expect(formatDuration(90)).toBe('1h30m')
        expect(formatDuration(150)).toBe('2h30m')
        expect(formatDuration(105)).toBe('1h45m')
        expect(formatDuration(1439)).toBe('23h59m')
    })

    it('should keep minute durations of 24 hours or longer in hours', () => {
        expect(formatDuration(1440, 'minute')).toBe('24h')
        expect(formatDuration(1500, 'minute')).toBe('25h')
        expect(formatDuration(2880, 'minute')).toBe('48h')
        expect(formatDuration(2910, 'minute')).toBe('48h30m')
    })

    it('should format day durations with the day unit', () => {
        expect(formatDuration(1, 'day')).toBe('1d')
        expect(formatDuration(4, 'day')).toBe('4d')
        expect(formatDuration(30, 'day')).toBe('30d')
    })

    it('should handle edge cases', () => {
        expect(formatDuration(0)).toBe('0m')
        expect(formatDuration(-5)).toBe('0m')
    })
})

describe('round trip parsing and formatting', () => {
    const testCases = [
        { input: '2h', expected: { amount: 120, unit: 'minute' }, expectedFormat: '2h' },
        { input: '45m', expected: { amount: 45, unit: 'minute' }, expectedFormat: '45m' },
        { input: '2h30m', expected: { amount: 150, unit: 'minute' }, expectedFormat: '2h30m' },
        { input: '1.5h', expected: { amount: 90, unit: 'minute' }, expectedFormat: '1h30m' },
        { input: '25h', expected: { amount: 1500, unit: 'minute' }, expectedFormat: '25h' },
        { input: '48h', expected: { amount: 2880, unit: 'minute' }, expectedFormat: '48h' },
        { input: '3d', expected: { amount: 3, unit: 'day' }, expectedFormat: '3d' },
    ] as const

    for (const { input, expected, expectedFormat } of testCases) {
        it(`should parse "${input}" and format back consistently`, () => {
            const parsed = parseDuration(input)
            expect(parsed).toEqual(expected)
            expect(formatDuration(parsed.amount, parsed.unit)).toBe(expectedFormat)
            expect(parseDuration(expectedFormat)).toEqual(expected)
        })
    }
})
