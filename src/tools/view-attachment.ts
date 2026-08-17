import type { ContentBlock } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
])

const TEXT_MIME_TYPES = new Set([
    'text/plain',
    'text/csv',
    'text/html',
    'text/markdown',
    'application/json',
    'application/xml',
    'text/xml',
])

const EXTENSION_TO_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
}

function getContentCategory(mimeType: string): 'image' | 'text' | 'binary' {
    if (IMAGE_MIME_TYPES.has(mimeType)) return 'image'
    if (TEXT_MIME_TYPES.has(mimeType) || mimeType.startsWith('text/')) return 'text'
    return 'binary'
}

function parseMimeType(contentType: string): string {
    // Strip charset and other parameters: "image/png; charset=utf-8" -> "image/png"
    const base = contentType.split(';')[0]
    return (base ?? contentType).trim().toLowerCase()
}

function getMimeTypeFromUrl(url: string): string | undefined {
    try {
        const pathname = new URL(url).pathname
        const lastDot = pathname.lastIndexOf('.')
        if (lastDot === -1) return undefined
        const ext = pathname.slice(lastDot).toLowerCase()
        return EXTENSION_TO_MIME[ext]
    } catch {
        return undefined
    }
}

function getFileNameFromUrl(url: string): string | undefined {
    try {
        const pathname = new URL(url).pathname
        const lastSlash = pathname.lastIndexOf('/')
        if (lastSlash === -1) return undefined
        const name = pathname.slice(lastSlash + 1)
        return name || undefined
    } catch {
        return undefined
    }
}

const ArgsSchema = {
    fileUrl: z
        .url()
        .describe(
            "The URL of the attachment file to view. Get this from the fileUrl field in a comment's fileAttachment.",
        ),
}

const viewAttachment = {
    name: ToolNames.VIEW_ATTACHMENT,
    description:
        "View a file attachment from a Todoist comment. Pass the fileUrl from a comment's fileAttachment field. Supports images (returned inline), text files (returned as text), and binary files like PDFs (returned as embedded resources).",
    parameters: ArgsSchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
    },
    async execute({ fileUrl }, client) {
        const response = await client.viewAttachment(fileUrl)

        const contentLength = response.headers['content-length']
        const headerFileSize = contentLength ? Number.parseInt(contentLength, 10) : undefined
        const fileName = getFileNameFromUrl(fileUrl)

        const rawContentType = response.headers['content-type']
        const headerMime = rawContentType ? parseMimeType(rawContentType) : undefined
        const mimeType =
            headerMime && headerMime !== 'application/octet-stream'
                ? headerMime
                : (getMimeTypeFromUrl(fileUrl) ?? headerMime ?? 'application/octet-stream')

        if (headerFileSize && headerFileSize > MAX_FILE_SIZE) {
            return {
                textContent: `Attachment "${fileName ?? fileUrl}" is too large to display inline (${(headerFileSize / 1024 / 1024).toFixed(1)}MB, limit is 10MB). File type: ${mimeType}`,
            }
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        const fileSize = buffer.byteLength

        if (fileSize > MAX_FILE_SIZE) {
            return {
                textContent: `Attachment "${fileName ?? fileUrl}" is too large to display inline (${(fileSize / 1024 / 1024).toFixed(1)}MB, limit is 10MB). File type: ${mimeType}`,
            }
        }

        const category = getContentCategory(mimeType)
        const contentItems: ContentBlock[] = []

        if (category === 'image') {
            contentItems.push({
                type: 'image',
                data: buffer.toString('base64'),
                mimeType,
            })
        } else if (category === 'text') {
            contentItems.push({
                type: 'text',
                text: buffer.toString('utf-8'),
            })
        } else {
            contentItems.push({
                type: 'resource',
                resource: {
                    uri: fileUrl,
                    mimeType,
                    blob: buffer.toString('base64'),
                },
            })
        }

        const textContent = `Attachment: ${fileName ?? 'unknown'} (${mimeType}, ${(fileSize / 1024).toFixed(1)}KB)`

        return {
            textContent,
            contentItems,
        }
    },
} satisfies TodoistTool<typeof ArgsSchema>

export { viewAttachment }
