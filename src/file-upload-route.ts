import { Transform, type TransformCallback } from 'node:stream'
import { TodoistRequestError } from '@doist/todoist-sdk'
import type { Request, RequestHandler, Response } from 'express'
import { createTodoistClient } from './usage-tracking.js'
import { readUploadTicket } from './utils/file-uploads.js'

type FileUploadHandlerOptions = {
    /** The same secret the server's `create-file-upload` tool encrypts tickets with. */
    secret: string
    baseUrl?: string
}

class UploadTooLargeError extends Error {}

/**
 * Passes bytes through until more than `maxBytes` have gone by, then fails the
 * stream. `Content-Length` is checked up front too, but a chunked body has none.
 */
function limitBytes(maxBytes: number): Transform {
    let seen = 0
    return new Transform({
        transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
            seen += chunk.length
            if (seen > maxBytes) {
                callback(new UploadTooLargeError())
                return
            }
            callback(null, chunk)
        },
    })
}

function sendError(res: Response, status: number, error: string, description: string): void {
    res.status(status).json({ error, error_description: description })
}

/**
 * Express handler for `POST|PUT /uploads/:ticket`, the URL `create-file-upload`
 * hands out.
 *
 * The body is the raw file bytes, not a multipart form, so the handler can
 * stream it straight into the Todoist upload endpoint without buffering or
 * parsing: memory stays flat whatever the file size. The ticket is the only
 * credential: it carries the user's token encrypted, so whoever holds the URL
 * can upload one file as that user until it expires. That is also why this
 * route skips the `/mcp` Host/Origin guard — an attacker without the ticket has
 * nothing to replay.
 */
function createFileUploadHandler({ secret, baseUrl }: FileUploadHandlerOptions): RequestHandler {
    return async (req: Request, res: Response): Promise<void> => {
        const ticket = readUploadTicket(String(req.params.ticket ?? ''), secret)
        if (!ticket.ok) {
            if (ticket.reason === 'expired') {
                sendError(
                    res,
                    410,
                    'expired_upload_url',
                    'This upload URL has expired. Call create-file-upload again for a new one.',
                )
            } else {
                sendError(res, 404, 'invalid_upload_url', 'This upload URL is not valid.')
            }
            return
        }

        const { token, fileName, maxBytes } = ticket.payload

        if (req.is('multipart/form-data')) {
            sendError(
                res,
                415,
                'unsupported_media_type',
                'Send the raw file bytes as the request body, not a multipart form. For example: curl --data-binary @file <url>',
            )
            return
        }

        const declaredLength = Number(req.headers['content-length'])
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            sendError(res, 413, 'file_too_large', `Files are limited to ${maxBytes} bytes.`)
            return
        }

        const body = req.pipe(limitBytes(maxBytes))
        let tooLarge = false
        body.on('error', (error) => {
            if (error instanceof UploadTooLargeError) tooLarge = true
        })

        try {
            const client = createTodoistClient(token, { baseUrl })
            const uploaded = await client.uploadFile({ file: body, fileName })
            if (!uploaded.fileUrl) {
                sendError(
                    res,
                    502,
                    'upload_failed',
                    'Todoist accepted the file but returned no URL.',
                )
                return
            }
            res.status(201).json({
                attachment: {
                    fileUrl: uploaded.fileUrl,
                    fileName: uploaded.fileName ?? fileName,
                    fileType: uploaded.fileType ?? undefined,
                    resourceType: uploaded.resourceType,
                },
            })
        } catch (error) {
            if (tooLarge) {
                sendError(res, 413, 'file_too_large', `Files are limited to ${maxBytes} bytes.`)
                return
            }
            if (error instanceof TodoistRequestError && error.httpStatusCode) {
                const status = error.isAuthenticationError() ? 401 : error.httpStatusCode
                sendError(res, status, 'upload_failed', error.message)
                return
            }
            console.error('[Error] File upload failed:', error)
            sendError(res, 502, 'upload_failed', 'The upload to Todoist failed.')
        }
    }
}

export { createFileUploadHandler, type FileUploadHandlerOptions }
