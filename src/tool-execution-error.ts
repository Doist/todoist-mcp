import { ZodError } from 'zod'

type ApiErrorInfo = {
    statusCode?: number
    code?: string | number
    tag?: string
    message?: string
    details?: string
    fieldHints: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
    return values.find(isRecord)
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
    return values.find((value): value is T => value !== undefined)
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        return Number(value.trim())
    }

    return undefined
}

function toStringValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : undefined
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }

    return undefined
}

function coerceErrorCode(value: unknown): string | number | undefined {
    const numeric = toNumber(value)
    if (numeric !== undefined) {
        return numeric
    }

    return toStringValue(value)
}

function redactSecrets(text: string): string {
    return text
        .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
        .replace(
            /\b(token|api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{6,}["']?/gi,
            '$1: [REDACTED]',
        )
        .replace(/([?&](?:token|api[_-]?key|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
}

function sanitizeErrorText(text: string, maxLength = 220): string {
    const redacted = redactSecrets(text).replace(/\s+/g, ' ').trim()
    if (redacted.length <= maxLength) {
        return redacted
    }

    return `${redacted.slice(0, maxLength - 3)}...`
}

function isGenericHttpMessage(message: string): boolean {
    const normalized = message.trim()
    return (
        /\bHTTP\s*\d{3}\b/i.test(normalized) ||
        /\bstatus code \d{3}\b/i.test(normalized) ||
        /^bad request$/i.test(normalized) ||
        /^unauthorized$/i.test(normalized) ||
        /^forbidden$/i.test(normalized) ||
        /^not found$/i.test(normalized)
    )
}

function extractStatusCodeFromText(message: string | undefined): number | undefined {
    if (!message) {
        return undefined
    }

    const match = message.match(/\b(?:HTTP|status code)\s*[:#-]?\s*(\d{3})\b/i)
    if (!match?.[1]) {
        return undefined
    }

    return toNumber(match[1])
}

function summarizeDetails(value: unknown): string | undefined {
    const primitive = toStringValue(value)
    if (primitive) {
        return sanitizeErrorText(primitive)
    }

    if (Array.isArray(value)) {
        const entries = value
            .map((entry) => {
                if (isRecord(entry)) {
                    return toStringValue(entry.message) || toStringValue(entry.error)
                }
                return toStringValue(entry)
            })
            .filter((entry): entry is string => Boolean(entry))

        if (entries.length > 0) {
            return sanitizeErrorText(entries.slice(0, 2).join('; '))
        }

        return undefined
    }

    if (!isRecord(value)) {
        return undefined
    }

    const detailText = firstDefined(
        toStringValue(value.detail),
        toStringValue(value.details),
        toStringValue(value.message),
        toStringValue(value.error),
        toStringValue(value.description),
    )
    if (detailText) {
        return sanitizeErrorText(detailText)
    }

    const parts: string[] = []
    for (const [key, entry] of Object.entries(value)) {
        const asText = toStringValue(entry)
        if (!asText) {
            continue
        }

        parts.push(`${key}: ${asText}`)
        if (parts.length >= 2) {
            break
        }
    }

    return parts.length > 0 ? sanitizeErrorText(parts.join('; ')) : undefined
}

function extractFieldHints(responseData: Record<string, unknown> | undefined): string[] {
    if (!responseData) {
        return []
    }

    const hints = new Set<string>()
    const addHint = (hint: string | undefined) => {
        if (!hint) {
            return
        }
        hints.add(sanitizeErrorText(hint, 120))
    }

    const singleFieldHint = firstDefined(
        toStringValue(responseData.field),
        toStringValue(responseData.parameter),
        toStringValue(responseData.param),
        toStringValue(responseData.path),
    )
    addHint(singleFieldHint)

    const detailsRecord = firstRecord(
        responseData.details,
        responseData.errorDetails,
        responseData.errorExtra,
        responseData.error_extra,
    )
    if (detailsRecord) {
        const detailFieldHint = firstDefined(
            toStringValue(detailsRecord.field),
            toStringValue(detailsRecord.parameter),
            toStringValue(detailsRecord.param),
            toStringValue(detailsRecord.path),
            toStringValue(detailsRecord.argument),
        )
        addHint(detailFieldHint)
    }

    const errors = responseData.errors
    if (Array.isArray(errors)) {
        for (const entry of errors) {
            if (!isRecord(entry)) {
                addHint(toStringValue(entry))
                continue
            }

            const field = firstDefined(
                toStringValue(entry.field),
                toStringValue(entry.parameter),
                toStringValue(entry.param),
                toStringValue(entry.path),
                toStringValue(entry.name),
            )
            const message = firstDefined(
                toStringValue(entry.message),
                toStringValue(entry.error),
                toStringValue(entry.detail),
                toStringValue(entry.description),
            )

            if (field && message) {
                addHint(`${field}: ${message}`)
            } else {
                addHint(field || message)
            }
        }
    } else if (isRecord(errors)) {
        for (const [key, value] of Object.entries(errors)) {
            const asText = toStringValue(value)
            if (asText) {
                addHint(`${key}: ${asText}`)
                continue
            }

            if (Array.isArray(value)) {
                const valueText = value
                    .map((entry) => toStringValue(entry))
                    .filter((entry): entry is string => Boolean(entry))
                    .join(', ')
                addHint(valueText ? `${key}: ${valueText}` : key)
            }
        }
    }

    return Array.from(hints).slice(0, 3)
}

/**
 * Canonical Todoist API error keys from docs:
 * - error, error_code, error_tag, http_code, error_extra
 *
 * Compatibility keys support SDK/client normalization to camelCase.
 * We read both formats because this module can receive either raw API payloads
 * (snake_case) or transformed payloads (camelCase), depending on the caller.
 */
const KNOWN_TODOIST_API_ERROR_KEYS = [
    'error',
    'error_code',
    'error_tag',
    'http_code',
    'error_extra',
    'errorCode',
    'errorTag',
    'httpCode',
    'errorExtra',
] as const

function hasKnownApiErrorKeys(responseData: Record<string, unknown> | undefined): boolean {
    if (!responseData) {
        return false
    }

    return KNOWN_TODOIST_API_ERROR_KEYS.some((key) => responseData[key] !== undefined)
}

function getNextStepHint(error: ApiErrorInfo): string {
    const { statusCode, tag, fieldHints } = error
    const hasFieldHints = fieldHints.length > 0

    // Todoist plan/usage limits (e.g. MAX_ITEMS_LIMIT_REACHED) come back as
    // 403s; pointing users at their API token sends them down the wrong path.
    if (tag && tag.endsWith('LIMIT_REACHED')) {
        return 'A Todoist plan or project limit was reached. Complete, archive, or delete items — or upgrade the plan — then retry.'
    }

    if (statusCode === 401) {
        return 'Verify your API token and access permissions, then retry.'
    }

    if (statusCode === 403) {
        // A specific error tag means the request was authenticated and
        // understood but rejected for the stated reason — not a token problem.
        if (tag && tag !== 'FORBIDDEN' && tag !== 'UNAUTHORIZED') {
            return 'The request was rejected for the reason in the message above — this is not an API token problem. Address it and retry.'
        }
        return 'Verify your API token and access permissions, then retry.'
    }

    if (statusCode === 404) {
        return 'Confirm the referenced IDs exist and are accessible, then retry.'
    }

    if (statusCode === 429) {
        return 'Rate limit reached. Wait briefly and retry.'
    }

    if (statusCode !== undefined && statusCode >= 500) {
        return 'Todoist API may be temporarily unavailable. Retry shortly.'
    }

    if (hasFieldHints) {
        return 'Fix the field hints above and retry.'
    }

    if (statusCode === 400 || statusCode === 422) {
        return 'Check parameter values and formats, then retry.'
    }

    return 'Check the request parameters and retry.'
}

function extractApiErrorInfo(error: unknown): ApiErrorInfo | null {
    const errorRecord = isRecord(error) ? error : undefined
    const errorCauseRecord =
        error instanceof Error && isRecord(error.cause)
            ? (error.cause as Record<string, unknown>)
            : undefined

    const responseRecord = firstRecord(errorRecord?.response, errorCauseRecord?.response)
    const responseData = firstRecord(
        errorRecord?.responseData,
        responseRecord?.data,
        errorRecord?.data,
        errorCauseRecord?.responseData,
        errorCauseRecord?.data,
    )

    const statusCode = firstDefined(
        toNumber(errorRecord?.httpStatusCode),
        toNumber(errorRecord?.statusCode),
        toNumber(errorRecord?.status),
        toNumber(responseRecord?.status),
        toNumber(responseData?.httpStatusCode),
        toNumber(responseData?.statusCode),
        toNumber(responseData?.status),
        toNumber(responseData?.httpCode),
        toNumber(responseData?.http_code),
        extractStatusCodeFromText(toStringValue(errorRecord?.message)),
        extractStatusCodeFromText(toStringValue(errorCauseRecord?.message)),
        extractStatusCodeFromText(typeof error === 'string' ? error : undefined),
    )

    const code = firstDefined(
        coerceErrorCode(responseData?.errorCode),
        coerceErrorCode(responseData?.error_code),
        coerceErrorCode(responseData?.code),
        coerceErrorCode(errorRecord?.errorCode),
        coerceErrorCode(errorRecord?.error_code),
        coerceErrorCode(errorRecord?.code),
    )

    const tag = firstDefined(
        toStringValue(responseData?.errorTag),
        toStringValue(responseData?.error_tag),
        toStringValue(responseData?.tag),
        toStringValue(errorRecord?.errorTag),
        toStringValue(errorRecord?.error_tag),
        toStringValue(errorRecord?.tag),
    )

    const rawMessageCandidates = [
        toStringValue(responseData?.error),
        toStringValue(responseData?.message),
        summarizeDetails(responseData?.message),
        toStringValue(errorRecord?.message),
        toStringValue(errorCauseRecord?.message),
        error instanceof Error ? error.message : toStringValue(error),
    ].filter((candidate): candidate is string => Boolean(candidate))

    const message =
        rawMessageCandidates.find((candidate) => !isGenericHttpMessage(candidate)) ||
        rawMessageCandidates[0]

    const details = firstDefined(
        summarizeDetails(responseData?.errorExtra),
        summarizeDetails(responseData?.error_extra),
        summarizeDetails(responseData?.details),
        summarizeDetails(responseData?.errorDetails),
        summarizeDetails(responseData?.errors),
        summarizeDetails(errorRecord?.details),
    )

    const fieldHints = extractFieldHints(responseData)

    const hasApiSignals =
        statusCode !== undefined ||
        hasKnownApiErrorKeys(responseData) ||
        tag !== undefined ||
        code !== undefined ||
        (message ? isGenericHttpMessage(message) : false)

    if (!hasApiSignals) {
        return null
    }

    return {
        statusCode,
        code,
        tag: tag ? sanitizeErrorText(tag, 80) : undefined,
        message: message ? sanitizeErrorText(message) : undefined,
        details: details ? sanitizeErrorText(details) : undefined,
        fieldHints,
    }
}

function formatApiErrorMessage(error: ApiErrorInfo): string {
    const context: string[] = []
    if (error.statusCode !== undefined) {
        context.push(`HTTP ${error.statusCode}`)
    }
    if (error.code !== undefined) {
        context.push(`code ${error.code}`)
    }
    if (error.tag) {
        context.push(`tag ${error.tag}`)
    }

    const lines = [
        context.length > 0
            ? `Todoist API request failed (${context.join(', ')}).`
            : 'Todoist API request failed.',
    ]

    if (error.message) {
        lines.push(`Message: ${error.message}`)
    }

    if (error.details && error.details !== error.message) {
        lines.push(`Details: ${error.details}`)
    }

    if (error.fieldHints.length > 0) {
        lines.push(`Field hints: ${error.fieldHints.join('; ')}`)
    }

    lines.push(`Try next: ${getNextStepHint(error)}`)

    return lines.join('\n')
}

function formatGenericError(error: unknown): string {
    if (error instanceof Error) {
        return sanitizeErrorText(error.message)
    }

    if (typeof error === 'string') {
        return sanitizeErrorText(error)
    }

    return 'An unknown error occurred'
}

/**
 * Format tool execution errors in a consistent, actionable format.
 *
 * This is the only public API exposed by this module.
 */
export function formatToolExecutionError(error: unknown): string {
    if (error instanceof ZodError) {
        return error.message
    }

    const parsedApiError = extractApiErrorInfo(error)
    if (parsedApiError) {
        return formatApiErrorMessage(parsedApiError)
    }

    return formatGenericError(error)
}
