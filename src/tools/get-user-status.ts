import type { TodoistTool } from '../todoist-tool.js'
import { ToolNames } from '../utils/tool-names.js'
import {
    buildUserStatusResult,
    fetchUserStatus,
    UserStatusOutputSchema,
} from '../utils/user-status.js'

const ArgsSchema = {}

const getUserStatus = {
    name: ToolNames.GET_USER_STATUS,
    description:
        "Get the user's status, the message and emoji shown next to their name in Todoist and Comms, with when it ends and whether it pauses Comms notifications or Karma and streaks. Returns no status when none is set or it has expired.",
    parameters: ArgsSchema,
    outputSchema: UserStatusOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(_args, client) {
        return buildUserStatusResult(await fetchUserStatus(client), 'Status')
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof UserStatusOutputSchema>

export { getUserStatus }
