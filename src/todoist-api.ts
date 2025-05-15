import path from 'node:path'
import type { TodoistApi } from '@doist/todoist-api-typescript'

const API_VERSION = '9.215'

// Since some endpoints are not directly exposed in the TypeScript client,
// We need to make a direct fetch request using the authentication token
// Access the private properties with a type assertion to a more specific interface
type TodoistApiInternal = { restApiBase: string; authToken: string }

export async function callRestTodoistApi(
    urlPath: string,
    api: TodoistApi,
    options: RequestInit = {},
) {
    // Access the private properties with a type assertion
    const baseUrl = (api as unknown as TodoistApiInternal).restApiBase || 'https://api.todoist.com'
    const authToken = (api as unknown as TodoistApiInternal).authToken

    options.headers = { ...options.headers, Authorization: `Bearer ${authToken}` }

    // Make API request
    const url = new URL(path.join(baseUrl, 'api', `v${API_VERSION}`, urlPath))
    const res = await fetch(url, options)

    if (!res.ok) throw new Error(`Todoist API error: ${url} ${res.status} ${await res.text()}`)

    return res
}
