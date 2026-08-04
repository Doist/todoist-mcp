type Page = {
    nextCursor?: string
}

/**
 * Fetch every page after an initial cursor-based tool result.
 *
 * The widget receives its first page from the host. Subsequent pages are fetched
 * directly from the MCP server so a paginated result is not presented as a
 * complete task list.
 */
async function loadRemainingPages<PageResult extends Page>({
    initialCursor,
    fetchPage,
    onPage,
}: {
    initialCursor: string | undefined
    fetchPage: (cursor: string) => Promise<PageResult>
    onPage: (page: PageResult) => void
}): Promise<void> {
    let cursor = initialCursor
    const seenCursors = new Set<string>()

    while (cursor) {
        if (seenCursors.has(cursor)) {
            throw new Error('Task pagination returned a repeated cursor.')
        }

        seenCursors.add(cursor)
        const page = await fetchPage(cursor)
        onPage(page)
        cursor = page.nextCursor
    }
}

export { loadRemainingPages }
