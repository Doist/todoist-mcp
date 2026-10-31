import type { TodoistApi } from '@doist/todoist-sdk'
import { executeWithRetry } from './retry.js'
import type { ToolName } from './tool-names.js'

type PersonalProjectCapacity = {
    /** The account's current plan limit on active personal projects. */
    maxProjects: number
    /** Active personal projects that count towards the limit. */
    activeCount: number
}

/**
 * Reads the account's personal project limit and how many projects count towards it.
 *
 * The API accepts a couple of projects beyond the plan limit, so offline clients
 * can sync at the boundary. It therefore does not reject a create, unarchive or
 * move-to-personal that the Todoist apps refuse; a tool that adds an active
 * personal project checks this capacity first, as the apps do. The SDK applies the
 * apps' counting rule: every active personal project except the Inbox.
 *
 * @returns The capacity, or `undefined` when the read fails or the plan has no
 * project limit. The underlying error is logged under `toolName`, since the message
 * the caller reports is deliberately generic.
 */
async function loadPersonalProjectCapacity(
    client: TodoistApi,
    toolName: ToolName,
): Promise<PersonalProjectCapacity | undefined> {
    try {
        const { maxProjects, activeCount } = await executeWithRetry(() =>
            client.getPersonalProjectCapacity(),
        )
        return { maxProjects, activeCount }
    } catch (error) {
        console.error(`${toolName}: could not load personal project limit`, error)
        return undefined
    }
}

/**
 * Throws unless the account has room for one more active personal project.
 *
 * @param outcome - What the caller did not do, e.g. "This project was not created."
 */
function assertPersonalProjectCapacity(
    capacity: PersonalProjectCapacity | undefined,
    outcome: string,
): asserts capacity is PersonalProjectCapacity {
    if (!capacity) {
        throw new Error(`Could not verify your personal project limit. ${outcome} Retry later.`)
    }

    if (capacity.activeCount >= capacity.maxProjects) {
        throw new Error(
            `Your account has reached its limit of ${capacity.maxProjects} active personal projects. ${outcome} ` +
                'Archive or delete a personal project, or upgrade to a plan with a higher limit, then retry.',
        )
    }
}

export { assertPersonalProjectCapacity, loadPersonalProjectCapacity }
export type { PersonalProjectCapacity }
