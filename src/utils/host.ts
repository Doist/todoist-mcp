import { isIP } from 'node:net'

/** Strip the surrounding brackets from a bracketed IPv6 literal, if present. */
function normalizeListenHost(host: string): string {
    if (host.startsWith('[') && host.endsWith(']')) {
        return host.slice(1, -1)
    }
    return host
}

/** Whether `host` refers to a loopback interface (localhost / 127.0.0.0/8 / ::1). */
function isLoopbackHost(host: string): boolean {
    host = normalizeListenHost(host)
    if (host === 'localhost') {
        return true
    }
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
        return true
    }
    if (isIP(host) === 4) {
        return host.split('.')[0] === '127'
    }
    return false
}

export { isLoopbackHost, normalizeListenHost }
