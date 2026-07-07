import z from 'zod'
import { formatToolExecutionError } from './tool-execution-error.js'

describe('formatToolExecutionError', () => {
    it('formats Todoist API errors with actionable details', () => {
        const output = formatToolExecutionError({
            httpStatusCode: 400,
            responseData: {
                error: 'Invalid due date format',
                errorCode: 42,
                errorTag: 'INVALID_ARGUMENT',
                parameter: 'dueString',
                details: 'Use natural language (e.g., "tomorrow") or YYYY-MM-DD.',
            },
        })

        expect(output).toContain(
            'Todoist API request failed (HTTP 400, code 42, tag INVALID_ARGUMENT).',
        )
        expect(output).toContain('Message: Invalid due date format')
        expect(output).toContain('Field hints: dueString')
        expect(output).toContain('Try next: Fix the field hints above and retry.')
    })

    it('supports canonical Todoist snake_case error payloads', () => {
        const output = formatToolExecutionError({
            responseData: {
                error: 'Invalid temporary id',
                error_code: 58,
                error_tag: 'INVALID_TEMP_ID',
                http_code: 400,
                error_extra: {
                    argument: 'temp_id_mapping',
                    explanation: 'At least one temporary id was not found.',
                },
            },
        })

        expect(output).toContain(
            'Todoist API request failed (HTTP 400, code 58, tag INVALID_TEMP_ID).',
        )
        expect(output).toContain('Message: Invalid temporary id')
        expect(output).toContain(
            'Details: argument: temp_id_mapping; explanation: At least one temporary id was not found.',
        )
        expect(output).toContain('Field hints: temp_id_mapping')
    })

    it('formats nested response errors consistently', () => {
        const output = formatToolExecutionError({
            message: 'Request failed with status code 404',
            response: {
                status: 404,
                data: {
                    message: 'Task not found',
                    errors: [{ field: 'taskId', message: 'No task matches this id' }],
                },
            },
        })

        expect(output).toContain('Todoist API request failed (HTTP 404).')
        expect(output).toContain('Message: Task not found')
        expect(output).toContain('Field hints: taskId: No task matches this id')
        expect(output).toContain(
            'Try next: Confirm the referenced IDs exist and are accessible, then retry.',
        )
    })

    it('points 403 limit errors at the limit, not the API token (Doist/Issues#20301)', () => {
        const output = formatToolExecutionError({
            responseData: {
                error: 'Maximum number of items per user project limit reached',
                error_code: 49,
                error_tag: 'MAX_ITEMS_LIMIT_REACHED',
                http_code: 403,
                error_extra: {},
            },
        })

        expect(output).toContain(
            'Todoist API request failed (HTTP 403, code 49, tag MAX_ITEMS_LIMIT_REACHED).',
        )
        expect(output).toContain('Message: Maximum number of items per user project limit reached')
        expect(output).toContain(
            'Try next: A Todoist plan or project limit was reached. Complete, archive, or delete items — or upgrade the plan — then retry.',
        )
        expect(output).not.toContain('Verify your API token')
    })

    it('does not blame the API token for 403s with a specific error tag', () => {
        const output = formatToolExecutionError({
            responseData: {
                error: 'Project is frozen',
                error_code: 63,
                error_tag: 'PROJECT_FROZEN',
                http_code: 403,
                error_extra: {},
            },
        })

        expect(output).toContain(
            'Try next: The request was rejected for the reason in the message above — this is not an API token problem. Address it and retry.',
        )
        expect(output).not.toContain('Verify your API token')
    })

    it('keeps the token hint for plain 403s', () => {
        const output = formatToolExecutionError({
            responseData: {
                error: 'Forbidden',
                error_tag: 'FORBIDDEN',
                http_code: 403,
            },
        })

        expect(output).toContain(
            'Try next: Verify your API token and access permissions, then retry.',
        )
    })

    it('keeps the token hint for 403s without a payload', () => {
        const output = formatToolExecutionError({ httpStatusCode: 403 })

        expect(output).toContain(
            'Try next: Verify your API token and access permissions, then retry.',
        )
    })

    it('keeps the token hint for 401s', () => {
        const output = formatToolExecutionError({
            httpStatusCode: 401,
            responseData: { error: 'Unauthorized' },
        })

        expect(output).toContain(
            'Try next: Verify your API token and access permissions, then retry.',
        )
    })

    it('extracts HTTP status from generic API error messages', () => {
        const output = formatToolExecutionError(new Error('HTTP 400: Bad Request'))

        expect(output).toContain('Todoist API request failed (HTTP 400).')
        expect(output).toContain('Message: HTTP 400: Bad Request')
        expect(output).toContain('Try next: Check parameter values and formats, then retry.')
    })

    it('redacts secret values in API errors', () => {
        const output = formatToolExecutionError({
            httpStatusCode: 401,
            responseData: {
                error: 'Unauthorized',
                details:
                    'Authorization: Bearer secret_token_123456789 and token=another_secret_value',
            },
        })

        expect(output).toContain('Todoist API request failed (HTTP 401).')
        expect(output).toContain('[REDACTED]')
        expect(output).not.toContain('secret_token_123456789')
        expect(output).not.toContain('another_secret_value')
    })

    it('keeps Zod validation errors unchanged', () => {
        const validationResult = z.object({ taskId: z.string() }).safeParse({ taskId: 123 })

        expect(validationResult.success).toBe(false)
        if (validationResult.success) {
            throw new Error('Expected Zod validation to fail')
        }

        expect(formatToolExecutionError(validationResult.error)).toBe(
            validationResult.error.message,
        )
    })

    it('returns non-API errors as plain messages', () => {
        expect(formatToolExecutionError(new Error('Simple failure'))).toBe('Simple failure')
    })

    it('does not mislabel generic errors with data payloads as API errors', () => {
        const error = Object.assign(new Error('Unexpected tool failure'), {
            data: { foo: 'bar' },
        })

        expect(formatToolExecutionError(error)).toBe('Unexpected tool failure')
    })
})
