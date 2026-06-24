import type { FileResponse, TodoistApi } from '@doist/todoist-sdk'
import type { Mocked } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { viewAttachment } from './view-attachment.js'

function createMockResponse({
    ok = true,
    status = 200,
    statusText = 'OK',
    contentType = 'application/octet-stream',
    contentLength,
    body,
}: {
    ok?: boolean
    status?: number
    statusText?: string
    contentType?: string
    contentLength?: string
    body?: ArrayBuffer | string
}): FileResponse {
    const headers: Record<string, string> = { 'content-type': contentType }
    if (contentLength) {
        headers['content-length'] = contentLength
    }

    const bodyBuffer =
        typeof body === 'string'
            ? new TextEncoder().encode(body).buffer
            : (body ?? new ArrayBuffer(0))

    return {
        ok,
        status,
        statusText,
        headers,
        arrayBuffer: vi.fn().mockResolvedValue(bodyBuffer),
        text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : ''),
        json: vi.fn().mockResolvedValue({}),
    }
}

const mockTodoistApi = {
    viewAttachment: vi.fn(),
} as unknown as Mocked<TodoistApi>

describe('view-attachment tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.viewAttachment.mockResolvedValue(createMockResponse({}))
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('should have correct metadata', () => {
        expect(viewAttachment.name).toBe('view-attachment')
        expect(viewAttachment.annotations.readOnlyHint).toBe(true)
        expect(viewAttachment.annotations.destructiveHint).toBe(false)
        expect(viewAttachment.annotations.idempotentHint).toBe(true)
    })

    it('should call client.viewAttachment with the file URL', async () => {
        mockTodoistApi.viewAttachment.mockResolvedValue(
            createMockResponse({
                contentType: 'text/plain',
                body: 'hello',
            }),
        )

        await viewAttachment.execute(
            { fileUrl: 'https://files.todoist.com/file.txt' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.viewAttachment).toHaveBeenCalledWith(
            'https://files.todoist.com/file.txt',
        )
    })

    describe('image files', () => {
        it('should return ImageContent for PNG files', async () => {
            const imageData = new Uint8Array([137, 80, 78, 71]).buffer // PNG magic bytes
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'image/png',
                    contentLength: '4',
                    body: imageData,
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/file.png' },
                mockTodoistApi,
            )

            expect(result.contentItems).toHaveLength(1)
            expect(result.contentItems?.[0]).toEqual({
                type: 'image',
                data: Buffer.from(imageData).toString('base64'),
                mimeType: 'image/png',
            })
            expect(result.textContent).toContain('file.png')
            expect(result.textContent).toContain('image/png')
        })

        it('should return ImageContent for JPEG files', async () => {
            const imageData = new Uint8Array([0xff, 0xd8, 0xff]).buffer
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'image/jpeg',
                    body: imageData,
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/photo.jpg' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toMatchObject({
                type: 'image',
                mimeType: 'image/jpeg',
            })
        })

        it('should return ImageContent for GIF files', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'image/gif',
                    body: new ArrayBuffer(10),
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/anim.gif' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toMatchObject({
                type: 'image',
                mimeType: 'image/gif',
            })
        })

        it('should return ImageContent for WebP files', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'image/webp',
                    body: new ArrayBuffer(10),
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/image.webp' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toMatchObject({
                type: 'image',
                mimeType: 'image/webp',
            })
        })
    })

    describe('text files', () => {
        it('should return TextContent for plain text files', async () => {
            const textContent = 'Hello, this is a text file.'
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'text/plain',
                    body: textContent,
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/notes.txt' },
                mockTodoistApi,
            )

            expect(result.contentItems).toHaveLength(1)
            expect(result.contentItems?.[0]).toEqual({
                type: 'text',
                text: textContent,
            })
            expect(result.textContent).toContain('text/plain')
        })

        it('should return TextContent for JSON files', async () => {
            const jsonContent = '{"key": "value"}'
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'application/json',
                    body: jsonContent,
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/data.json' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toEqual({
                type: 'text',
                text: jsonContent,
            })
        })

        it('should return TextContent for CSV files', async () => {
            const csvContent = 'name,age\nAlice,30'
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'text/csv',
                    body: csvContent,
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/data.csv' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toEqual({
                type: 'text',
                text: csvContent,
            })
        })

        it('should return TextContent for HTML files', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'text/html',
                    body: '<h1>Hello</h1>',
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/page.html' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toEqual({
                type: 'text',
                text: '<h1>Hello</h1>',
            })
            expect((result as Record<string, unknown>).structuredContent).toBeUndefined()
        })
    })

    describe('binary files', () => {
        it('should return EmbeddedResource for PDF files', async () => {
            const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer // %PDF
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'application/pdf',
                    contentLength: '4',
                    body: pdfData,
                }),
            )

            const fileUrl = 'https://files.todoist.com/upload/document.pdf'
            const result = await viewAttachment.execute({ fileUrl }, mockTodoistApi)

            expect(result.contentItems).toHaveLength(1)
            expect(result.contentItems?.[0]).toEqual({
                type: 'resource',
                resource: {
                    uri: fileUrl,
                    mimeType: 'application/pdf',
                    blob: Buffer.from(pdfData).toString('base64'),
                },
            })
            expect(result.textContent).toContain('application/pdf')
        })

        it('should return EmbeddedResource for unknown binary types', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'application/zip',
                    body: new ArrayBuffer(10),
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/archive.zip' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toMatchObject({
                type: 'resource',
                resource: { mimeType: 'application/zip' },
            })
        })
    })

    describe('content-type handling', () => {
        it('should strip charset from content-type header', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'text/plain; charset=utf-8',
                    body: 'hello',
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/file.txt' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('text/plain')
            expect(result.contentItems?.[0]).toMatchObject({ type: 'text' })
        })

        it('should fall back to URL extension when content-type is application/octet-stream', async () => {
            const imageData = new ArrayBuffer(4)
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'application/octet-stream',
                    body: imageData,
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/photo.png' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('image/png')
            expect(result.contentItems?.[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
        })

        it('should use application/octet-stream when no content-type and no extension match', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'application/octet-stream',
                    body: new ArrayBuffer(4),
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/noextension' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('application/octet-stream')
            expect(result.contentItems?.[0]).toMatchObject({ type: 'resource' })
        })

        it('should fall back to URL extension for PDF when content-type is generic', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'application/octet-stream',
                    body: new ArrayBuffer(4),
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/doc.pdf' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('application/pdf')
        })
    })

    describe('file size handling', () => {
        it('should return metadata-only when content-length header exceeds 10MB', async () => {
            const largeSize = (11 * 1024 * 1024).toString()
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'image/png',
                    contentLength: largeSize,
                    body: new ArrayBuffer(0),
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/huge.png' },
                mockTodoistApi,
            )

            expect(result.contentItems).toBeUndefined()
            expect(result.textContent).toContain('too large')
            expect(result.textContent).toContain('10MB')
        })

        it('should return metadata-only when actual body exceeds 10MB even without content-length', async () => {
            const largeBody = new ArrayBuffer(11 * 1024 * 1024)
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'image/png',
                    body: largeBody,
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/huge.png' },
                mockTodoistApi,
            )

            expect(result.contentItems).toBeUndefined()
            expect(result.textContent).toContain('too large')
        })

        it('should use actual body size for fileSize in text content', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'text/plain',
                    body: 'hello',
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/file.txt' },
                mockTodoistApi,
            )

            expect(result.contentItems?.[0]).toEqual({
                type: 'text',
                text: 'hello',
            })
            expect(result.textContent).toContain('0.0KB')
        })
    })

    describe('error handling', () => {
        it('should propagate errors from client.viewAttachment', async () => {
            mockTodoistApi.viewAttachment.mockRejectedValue(
                new Error('Failed to fetch attachment: 404 Not Found'),
            )

            await expect(
                viewAttachment.execute(
                    { fileUrl: 'https://files.todoist.com/upload/missing.png' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Failed to fetch attachment: 404 Not Found')
        })

        it('should propagate network errors', async () => {
            mockTodoistApi.viewAttachment.mockRejectedValue(new Error('Network error'))

            await expect(
                viewAttachment.execute(
                    { fileUrl: 'https://files.todoist.com/upload/file.png' },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('Network error')
        })
    })

    describe('text content', () => {
        it('should include file name from URL in text content', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'image/png',
                    body: new ArrayBuffer(4),
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/upload/screenshot.png' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('screenshot.png')
            expect(result.textContent).toContain('image/png')
        })

        it('should handle URLs without file names gracefully', async () => {
            mockTodoistApi.viewAttachment.mockResolvedValue(
                createMockResponse({
                    contentType: 'text/plain',
                    body: 'content',
                }),
            )

            const result = await viewAttachment.execute(
                { fileUrl: 'https://files.todoist.com/' },
                mockTodoistApi,
            )

            expect(result.textContent).toContain('unknown')
        })
    })
})
