import { ZodError } from 'zod'

type ApiErrorInfo = {
    statusCode?: number
    code?: string | number
    tag?: string
    message?: string
    details?: string
    rawText?: string[]
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

/**
 * Targeted guidance for specific Todoist API errors, keyed by canonical
 * `error_tag`. These take precedence over the generic status-code hints:
 * e.g. a full project surfaces as HTTP 403, and without this mapping the
 * error would be indistinguishable from an auth/permission failure.
 */
const TODOIST_ERROR_TAG_HINTS: Record<string, string> = {
    MAX_ITEMS_LIMIT_REACHED:
        'This project has reached the maximum number of active tasks per project (subtasks count toward it; completed tasks do not). ' +
        'The cap is the same on every Todoist plan — upgrading will not raise it — and it is not an authentication or permission problem. ' +
        'Complete, delete, or move existing tasks out of the project, or add the task to a different project, then retry.',
}

function findKnownTagHintInText(...texts: Array<string | undefined>): string | undefined {
    for (const text of texts) {
        if (!text) {
            continue
        }

        const normalized = text.toUpperCase()
        const tag = Object.keys(TODOIST_ERROR_TAG_HINTS).find((knownTag) =>
            normalized.includes(knownTag),
        )
        if (tag) {
            return TODOIST_ERROR_TAG_HINTS[tag]
        }
    }

    return undefined
}

function getKnownErrorHint(error: ApiErrorInfo): string | undefined {
    if (error.tag) {
        const hint = TODOIST_ERROR_TAG_HINTS[error.tag.toUpperCase()]
        if (hint) {
            return hint
        }
    }

    // Wrapper errors (e.g. batch tools embedding per-item failures into a new
    // Error) lose the structured fields; recover known tags from raw text
    // before sanitized display text can truncate the tag.
    return findKnownTagHintInText(...(error.rawText ?? []), error.message, error.details)
}

function getNextStepHint(error: ApiErrorInfo): string {
    const knownErrorHint = getKnownErrorHint(error)
    if (knownErrorHint) {
        return knownErrorHint
    }

    const { statusCode } = error
    const hasFieldHints = error.fieldHints.length > 0

    if (statusCode === 401 || statusCode === 403) {
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
        rawText: rawMessageCandidates,
        fieldHints,
    }
}

function buildErrorContext(error: ApiErrorInfo): string[] {
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

    return context
}

function formatApiErrorMessage(error: ApiErrorInfo): string {
    const context = buildErrorContext(error)

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
 * Compact single-line variant of {@link formatToolExecutionError} for batch
 * tools that report per-item failures. Unlike `error.message` (which for SDK
 * errors is just "HTTP 403: Forbidden"), this preserves the API error signals
 * (status, code, tag) so failures like MAX_ITEMS_LIMIT_REACHED stay
 * recognizable after aggregation.
 */
export function formatBatchItemError(error: unknown): string {
    const parsedApiError = extractApiErrorInfo(error)
    if (!parsedApiError) {
        return formatGenericError(error)
    }

    const context = buildErrorContext(parsedApiError)
    const message =
        parsedApiError.message &&
        !(context.length > 0 && isGenericHttpMessage(parsedApiError.message))
            ? parsedApiError.message
            : 'Todoist API request failed'

    return context.length > 0 ? `${message} (${context.join(', ')})` : message
}

/**
 * Format tool execution errors in a consistent, actionable format.
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
