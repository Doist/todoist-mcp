import z from 'zod'
import {
    BatchDueStringParseError,
    DueStringParseError,
    formatBatchItemError,
    formatDueStringParseError,
    formatToolExecutionError,
} from './tool-execution-error.js'

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
        expect(output).toContain('Retrying the same request will not help')
        expect(output).not.toContain('then retry')
    })

    it('covers both the scope/access and permission-decision remediations on 403', () => {
        const output = formatToolExecutionError({
            httpStatusCode: 403,
            responseData: {
                error: 'Insufficient token scope',
                error_tag: 'FORBIDDEN',
                http_code: 403,
            },
        })

        // A scope/access-denied 403 cannot be fixed by changing the request — the hint
        // must point the caller toward a token/account with the required access too.
        expect(output).toContain('insufficient token scope')
        expect(output).toContain('required access')
        expect(output).toContain('change the request or target')
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

    describe('project item-limit errors (MAX_ITEMS_LIMIT_REACHED)', () => {
        it('surfaces item-limit guidance instead of the generic 403 auth hint', () => {
            // Shape thrown by the SDK for REST calls: an Error with
            // httpStatusCode + the raw snake_case API body in responseData.
            const error = Object.assign(new Error('HTTP 403: Forbidden'), {
                httpStatusCode: 403,
                responseData: {
                    error: 'Maximum number of items exceeded',
                    error_code: 49,
                    error_tag: 'MAX_ITEMS_LIMIT_REACHED',
                    http_code: 403,
                },
            })

            const output = formatToolExecutionError(error)

            expect(output).toContain(
                'Todoist API request failed (HTTP 403, code 49, tag MAX_ITEMS_LIMIT_REACHED).',
            )
            expect(output).toContain('Message: Maximum number of items exceeded')
            expect(output).toContain('maximum number of active tasks')
            expect(output).toContain('not an authentication or permission problem')
            // The cap is identical on Beginner/Pro/Business (per the Todoist
            // usage-limits docs), so the copy must not nudge a plan upgrade.
            expect(output).toContain('upgrading will not raise it')
            expect(output).not.toContain('Verify your API token')
        })

        it('supports camelCase item-limit payloads', () => {
            const output = formatToolExecutionError({
                httpStatusCode: 403,
                responseData: {
                    error: 'Maximum number of items exceeded',
                    errorCode: 49,
                    errorTag: 'MAX_ITEMS_LIMIT_REACHED',
                },
            })

            expect(output).toContain('tag MAX_ITEMS_LIMIT_REACHED')
            expect(output).toContain('maximum number of active tasks')
            expect(output).not.toContain('Verify your API token')
        })

        it('advises against retrying plain 403s without item-limit signals', () => {
            const output = formatToolExecutionError({
                httpStatusCode: 403,
                responseData: { error: 'Forbidden' },
            })

            expect(output).toContain('Todoist API request failed (HTTP 403).')
            expect(output).toContain(
                'Try next: Access denied. Retrying the same request will not help',
            )
            expect(output).not.toContain('maximum number of active tasks')
        })

        it('recovers the item-limit tag from wrapper errors that embed per-item failures', () => {
            // Shape thrown by batch tools (e.g. add-tasks) when every item
            // fails: a plain Error whose message embeds the per-item summaries.
            const output = formatToolExecutionError(
                new Error(
                    'All 1 task(s) failed to create: "one too many": Maximum number of items exceeded (HTTP 403, code 49, tag MAX_ITEMS_LIMIT_REACHED)',
                ),
            )

            expect(output).toContain('maximum number of active tasks')
            expect(output).not.toContain('Verify your API token')
        })

        it('recovers the item-limit tag from long wrapper errors before display truncation', () => {
            const longTaskTitle = 'x'.repeat(260)
            const output = formatToolExecutionError(
                new Error(
                    `All 1 task(s) failed to create: "${longTaskTitle}": Maximum number of items exceeded (HTTP 403, code 49, tag MAX_ITEMS_LIMIT_REACHED)`,
                ),
            )

            expect(output).toContain('maximum number of active tasks')
            expect(output).not.toContain('Verify your API token')
        })
    })

    describe('formatBatchItemError', () => {
        it('preserves API error signals lost by error.message', () => {
            const error = Object.assign(new Error('HTTP 403: Forbidden'), {
                httpStatusCode: 403,
                responseData: {
                    error: 'Maximum number of items exceeded',
                    error_code: 49,
                    error_tag: 'MAX_ITEMS_LIMIT_REACHED',
                    http_code: 403,
                },
            })

            expect(formatBatchItemError(error)).toBe(
                'Maximum number of items exceeded (HTTP 403, code 49, tag MAX_ITEMS_LIMIT_REACHED)',
            )
        })

        it('avoids repeating generic HTTP messages when context is available', () => {
            const error = Object.assign(new Error('HTTP 403: Forbidden'), {
                httpStatusCode: 403,
            })

            expect(formatBatchItemError(error)).toBe('Todoist API request failed (HTTP 403)')
        })

        it('returns plain messages for non-API errors', () => {
            expect(formatBatchItemError(new Error('Section "xyz" not found'))).toBe(
                'Section "xyz" not found',
            )
        })
    })

    describe('formatDueStringParseError', () => {
        it('gives an explicit retry for the malformed recurring prefix', () => {
            const error = Object.assign(new Error('HTTP 400: Bad Request'), {
                httpStatusCode: 400,
                responseData: { error: 'Invalid date format' },
            })

            expect(
                formatDueStringParseError(error, {
                    taskContent: 'Lavendel abschneiden',
                    dueString: 'recurring every year on July 1',
                }),
            ).toBe(
                'Task "Lavendel abschneiden" wasn\'t created because `dueString` could not be parsed. Use Todoist recurrence syntax, for example `every year on July 1`; don\'t prefix it with `recurring`. Change only `dueString` and retry.',
            )
        })

        it('preserves every retry guidance after an all-failed batch wraps it', () => {
            const output = formatToolExecutionError(
                new BatchDueStringParseError(
                    'All 2 task(s) failed to create: "Lavendel abschneiden": Task "Lavendel abschneiden" wasn\'t created because `dueString` could not be parsed. Use Todoist recurrence syntax, for example `every year on July 1`; don\'t prefix it with `recurring`. Change only `dueString` and retry.; "Frauenmantel abschneiden": Task "Frauenmantel abschneiden" wasn\'t created because `dueString` could not be parsed. Use Todoist recurrence syntax, for example `every year on July 1`; don\'t prefix it with `recurring`. Change only `dueString` and retry.',
                ),
            )

            expect(output).toContain('All 2 task(s) failed to create')
            expect(output).toContain('Lavendel abschneiden')
            expect(output).toContain('Frauenmantel abschneiden')
        })

        it('preserves dueString recovery guidance in batch-item output', () => {
            const recovery =
                'Task "Lavendel abschneiden" wasn\'t created because `dueString` could not be parsed. Change only `dueString` and retry.'

            expect(formatBatchItemError(new DueStringParseError(recovery))).toBe(recovery)
        })

        it('returns a safe generic dueString retry for a non-recurring expression', () => {
            const error = Object.assign(new Error('HTTP 400: Bad Request'), {
                httpStatusCode: 400,
                responseData: { error: 'Invalid date format' },
            })

            expect(
                formatDueStringParseError(error, {
                    taskContent: 'Lavendel abschneiden',
                    dueString: 'tomorrow',
                }),
            ).toBe(
                'Task "Lavendel abschneiden" wasn\'t created because `dueString` could not be parsed. Change only `dueString` and retry.',
            )
        })

        it('does not give an empty example for a bare recurring prefix', () => {
            const error = Object.assign(new Error('HTTP 400: Bad Request'), {
                httpStatusCode: 400,
                responseData: { error: 'Invalid date format' },
            })

            expect(
                formatDueStringParseError(error, {
                    taskContent: 'Lavendel abschneiden',
                    dueString: 'recurring',
                }),
            ).toBe(
                'Task "Lavendel abschneiden" wasn\'t created because `dueString` could not be parsed. Use a complete Todoist recurrence expression; `recurring` alone is not valid. Change only `dueString` and retry.',
            )
        })

        it('does not attribute a generic date error to dueString when deadlineDate is supplied', () => {
            const error = Object.assign(new Error('HTTP 400: Bad Request'), {
                httpStatusCode: 400,
                responseData: { error: 'Invalid date format' },
            })

            expect(
                formatDueStringParseError(error, {
                    taskContent: 'Task',
                    dueString: 'tomorrow',
                    deadlineDate: 'not-a-date',
                }),
            ).toBeUndefined()
        })
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
