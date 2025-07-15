/**
 * Generic function to cap paginated results from a Todoist API function
 * @param apiFunction - The Todoist API function that accepts cursor parameter
 * @param params - Initial parameters to pass to the API function
 * @param maxPages - Maximum number of pages to fetch (default: 3)
 * @returns Promise with all results from paginated API calls
 */
export async function getMaxPaginatedResults<
    T extends { cursor: string | null },
    R extends { results: unknown[]; nextCursor: string | null },
>(
    apiFunction: (params: T) => Promise<R>,
    params: T = {} as T,
    maxPages: number = 3,
): Promise<unknown[]> {
    const results: unknown[] = []
    let currentParams = { ...params }
    let pagesFetched = 0

    while (pagesFetched < maxPages) {
        const response = await apiFunction(currentParams)
        results.push(...response.results)

        if (!response.nextCursor) {
            break
        }

        currentParams = { ...currentParams, cursor: response.nextCursor }
        pagesFetched++
    }

    return results
}
