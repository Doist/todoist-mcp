import type { TodoistApi } from '@doist/todoist-sdk'
import { z } from 'zod'
import { fetchAllActiveProjects, isPersonalProject } from '../tool-helpers.js'
import { executeWithRetry } from './retry.js'
import type { ToolName } from './tool-names.js'

const PersonalProjectLimitSchema = z.number().int().nonnegative()

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
 * personal project checks this capacity first, as the apps do.
 *
 * Counts every active personal project except the Inbox, matching the Todoist apps.
 *
 * @returns The capacity, or `undefined` when either read fails or the limit is
 * missing or malformed. The underlying error is logged under `toolName`, since
 * the message the caller reports is deliberately generic.
 */
async function loadPersonalProjectCapacity(
    client: TodoistApi,
    toolName: ToolName,
): Promise<PersonalProjectCapacity | undefined> {
    try {
        const [limits, projects] = await Promise.all([
            executeWithRetry(() =>
                client.sync({ resourceTypes: ['user_plan_limits'], syncToken: '*' }),
            ),
            fetchAllActiveProjects(client),
        ])
        // The SDK preserves this field via a loose schema, so validate it before use.
        const maxProjects = PersonalProjectLimitSchema.parse(
            limits.userPlanLimits?.current?.maxProjects,
        )
        const activeCount = projects.filter(
            (project) =>
                isPersonalProject(project) &&
                !project.inboxProject &&
                !project.isArchived &&
                !project.isDeleted,
        ).length

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
