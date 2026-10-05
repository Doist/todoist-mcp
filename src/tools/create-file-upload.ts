import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { getFileUploadIssuer } from '../utils/file-uploads.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    fileName: z
        .string()
        .min(1)
        .max(255)
        .describe('The name the file will have in Todoist, including its extension.'),
}

const OutputSchema = {
    uploadUrl: z.string().describe('Short-lived upload URL. Keep it private.'),
    method: z.literal('POST'),
    expiresAt: z.string().describe('ISO 8601 expiry.'),
    maxBytes: z.number(),
    fileName: z.string(),
}

const createFileUpload = {
    name: ToolNames.CREATE_FILE_UPLOAD,
    description:
        'Get a short-lived URL to upload one local file for attaching to a comment. ' +
        'POST the raw bytes (not multipart) to uploadUrl, e.g. `curl --data-binary @report.pdf "<uploadUrl>"`, ' +
        'then pass the `attachment` object from its JSON response unchanged to add-comments. ' +
        'Needs a way to make HTTP requests, such as a shell. For text you wrote, use fileContent on add-comments instead.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ fileName }, client) {
        const issuer = getFileUploadIssuer(client)
        if (!issuer) {
            throw new Error(
                'File uploads are not enabled on this server. To attach text you wrote, use fileContent on add-comments.',
            )
        }

        const { uploadUrl, expiresAt, maxBytes } = issuer.issue(fileName)
        const textContent = [
            `Upload URL for "${fileName}" (expires ${expiresAt.toISOString()}, max ${maxBytes} bytes):`,
            uploadUrl,
            '',
            'Send the file with:',
            `curl --data-binary @<path-to-file> "${uploadUrl}"`,
            '',
            'Then pass the `attachment` object from the JSON response to add-comments.',
        ].join('\n')

        return {
            textContent,
            structuredContent: {
                uploadUrl,
                method: 'POST' as const,
                expiresAt: expiresAt.toISOString(),
                maxBytes,
                fileName,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { createFileUpload }
