import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { TodoistApi } from '@doist/todoist-sdk'

/**
 * Server-side configuration for agent file uploads.
 *
 * Uploads only work where the server has a public URL a client can send bytes
 * to, so this is opt-in: without it `create-file-upload` is not registered.
 */
type FileUploadsConfig = {
    /**
     * Secret used to encrypt upload tickets. At least 32 characters. Rotating it
     * invalidates every ticket still in flight, which is harmless given their
     * short lifetime.
     */
    secret: string
    /** Public origin the upload route is reachable at, e.g. `https://ai.todoist.net`. */
    publicUrl: string
    /** How long a ticket stays valid. Defaults to 10 minutes. */
    ttlSeconds?: number
    /** Largest upload accepted. Defaults to 20 MiB; the user's plan limit still applies on top. */
    maxBytes?: number
}

/** What a ticket carries, encrypted, from the tool that minted it to the upload route. */
type UploadTicketPayload = {
    /** The Todoist token the upload is made with. Never leaves the server in clear text. */
    token: string
    fileName: string
    maxBytes: number
    /** Expiry, as epoch milliseconds. */
    expiresAt: number
}

type UploadTicketResult =
    | { ok: true; payload: UploadTicketPayload }
    | { ok: false; reason: 'invalid' | 'expired' }

const UPLOAD_ROUTE_PREFIX = '/uploads/'
const DEFAULT_TTL_SECONDS = 10 * 60
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const MIN_SECRET_LENGTH = 32
const TICKET_VERSION = 1
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

/**
 * Hosts the Todoist API hands out attachment URLs on. `add-comments` only
 * accepts attachments on these, so a model cannot pass an arbitrary link off as
 * an uploaded file.
 */
const TODOIST_ATTACHMENT_HOSTS = new Set([
    'files.todoist.com',
    'todoist.b-cdn.net',
    'd1ysz50cxb9zwl.cloudfront.net',
])

function deriveKey(secret: string): Buffer {
    if (secret.length < MIN_SECRET_LENGTH) {
        throw new Error(`File upload secret must be at least ${MIN_SECRET_LENGTH} characters`)
    }
    return createHash('sha256').update(secret).digest()
}

/**
 * Encrypt an upload ticket. AES-256-GCM, so a ticket can be neither read nor
 * forged without the secret, and the server needs no store to honour it.
 */
function createUploadTicket(payload: UploadTicketPayload, secret: string): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
    const plaintext = JSON.stringify({ v: TICKET_VERSION, ...payload })
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url')
}

function readUploadTicket(ticket: string, secret: string, now = Date.now()): UploadTicketResult {
    let payload: UploadTicketPayload & { v?: number }
    try {
        const raw = Buffer.from(ticket, 'base64url')
        if (raw.length <= IV_BYTES + AUTH_TAG_BYTES) return { ok: false, reason: 'invalid' }

        const iv = raw.subarray(0, IV_BYTES)
        const authTag = raw.subarray(raw.length - AUTH_TAG_BYTES)
        const ciphertext = raw.subarray(IV_BYTES, raw.length - AUTH_TAG_BYTES)
        const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv)
        decipher.setAuthTag(authTag)
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        payload = JSON.parse(plaintext.toString('utf8'))
    } catch {
        return { ok: false, reason: 'invalid' }
    }

    if (payload.v !== TICKET_VERSION) return { ok: false, reason: 'invalid' }
    if (now >= payload.expiresAt) return { ok: false, reason: 'expired' }

    return {
        ok: true,
        payload: {
            token: payload.token,
            fileName: payload.fileName,
            maxBytes: payload.maxBytes,
            expiresAt: payload.expiresAt,
        },
    }
}

/** Everything `create-file-upload` needs to mint a ticket for one server's user. */
type FileUploadIssuer = {
    issue(fileName: string): { uploadUrl: string; expiresAt: Date; maxBytes: number }
}

function createFileUploadIssuer(
    config: FileUploadsConfig,
    todoistApiKey: string,
): FileUploadIssuer {
    const ttlMs = (config.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000
    const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
    const origin = new URL(config.publicUrl).origin
    // Fail at server start rather than on the first upload.
    deriveKey(config.secret)

    return {
        issue(fileName) {
            const expiresAt = Date.now() + ttlMs
            const ticket = createUploadTicket(
                { token: todoistApiKey, fileName, maxBytes, expiresAt },
                config.secret,
            )
            return {
                uploadUrl: `${origin}${UPLOAD_ROUTE_PREFIX}${ticket}`,
                expiresAt: new Date(expiresAt),
                maxBytes,
            }
        },
    }
}

/**
 * Tools only receive the API client, so the issuer for a server is looked up by
 * the client that server was built with. A WeakMap keeps it from outliving the
 * per-request server the HTTP transport creates.
 */
const issuersByClient = new WeakMap<TodoistApi, FileUploadIssuer>()

function setFileUploadIssuer(client: TodoistApi, issuer: FileUploadIssuer): void {
    issuersByClient.set(client, issuer)
}

function getFileUploadIssuer(client: TodoistApi): FileUploadIssuer | undefined {
    return issuersByClient.get(client)
}

function isTodoistAttachmentUrl(url: string): boolean {
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'https:' && TODOIST_ATTACHMENT_HOSTS.has(parsed.hostname)
    } catch {
        return false
    }
}

export {
    createFileUploadIssuer,
    createUploadTicket,
    DEFAULT_MAX_BYTES,
    type FileUploadIssuer,
    type FileUploadsConfig,
    getFileUploadIssuer,
    isTodoistAttachmentUrl,
    readUploadTicket,
    setFileUploadIssuer,
    UPLOAD_ROUTE_PREFIX,
    type UploadTicketPayload,
}
