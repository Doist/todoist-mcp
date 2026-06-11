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

    it('extracts HTTP status from generic API error messages', () => {
        const output = formatToolExecutionError(new Error('HTTP 400: Bad Request'))

        expect(output).toContain('Todoist API request failed (HTTP 400).')
        expect(output).toContain('Message: HTTP 400: Bad Request')
        expect(output).toContain('Try next: Check parameter values and formats, then retry.')
    })

    it('advises against retrying on 403 forbidden responses', () => {
        const output = formatToolExecutionError({
            httpStatusCode: 403,
            responseData: {
                error: 'Not allowed to move objects out of a workspace',
                error_tag: 'FORBIDDEN',
                http_code: 403,
            },
        })

        expect(output).toContain('Message: Not allowed to move objects out of a workspace')
        expect(output).toContain('Do not retry the same request')
        expect(output).not.toContain('then retry')
    })

    it('keeps token guidance distinct on 401 unauthorized responses', () => {
        const output = formatToolExecutionError({
            httpStatusCode: 401,
            responseData: { error: 'Unauthorized', http_code: 401 },
        })

        expect(output).toContain(
            'Try next: Authentication failed. Verify your API token, then retry.',
        )
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
