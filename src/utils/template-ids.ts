import { parseTodoistUrl } from '@todoist/sdk'

/**
 * Accepts a bare template ID or a Todoist template URL. Both gallery links
 * (`/templates/product-launch`) and in-app links
 * (`/app/templates/category/my-templates/UT_28Ex.../view`) reduce to the last
 * path segment once a trailing `/view` is dropped. Non-Todoist hosts are
 * rejected rather than reduced, so a look-alike link cannot quietly resolve to
 * a real gallery slug.
 */
function extractTemplateId(input: string): string {
    const trimmed = input.trim()

    if (!/^https?:\/\//i.test(trimmed)) {
        return trimmed
    }

    let url: URL
    try {
        url = new URL(trimmed)
    } catch {
        throw new Error(`Could not read a template ID from "${trimmed}".`)
    }

    if (!isTodoistHost(url.hostname)) {
        throw new Error(
            `"${url.hostname}" is not a Todoist domain. Pass a todoist.com template URL or the template ID itself.`,
        )
    }

    // The SDK recognises a fixed set of Todoist hosts, which is narrower than
    // the subdomains accepted above, so point the URL at the canonical host
    // before reading the template ID out of the path.
    url.hostname = 'todoist.com'

    const parsed = parseTodoistUrl(url.toString())
    if (parsed?.type !== 'template') {
        throw new Error(`"${trimmed}" is not a Todoist template URL.`)
    }

    return parsed.id
}

function isTodoistHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return host === 'todoist.com' || host.endsWith('.todoist.com')
}

export { extractTemplateId }
