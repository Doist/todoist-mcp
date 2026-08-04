import type { MoveTaskArgs, Task } from '@doist/todoist-sdk'

/** The container fields a caller can send to relocate a task. */
type MoveRequest = {
    projectId?: string | undefined
    sectionId?: string | undefined
    parentId?: string | undefined
}

type MovePlan = {
    /** The move to perform, or undefined when the task is already where it was asked to go. */
    move?: MoveTaskArgs
    /** True when a requested destination was dropped as already-satisfied. */
    redundantMoveSkipped: boolean
}

/**
 * Whether moving `current` to `destination` would leave the task exactly where it
 * already is, making the request a pointless write.
 *
 * Matching the destination field alone is not enough. Moving a task to a project
 * also lifts it out of its section and out from under its parent, and moving it
 * to a section lifts it out from under its parent — so a task that matches on
 * `projectId` but sits in a section is *not* already in the requested end state.
 *
 * The extra conditions therefore make this predicate conservative on purpose: it
 * only reports "redundant" when the task already looks the way the move would
 * leave it under those detaching semantics. If the API turned out not to detach,
 * the cost is a move we could have skipped, never a move we wrongly skipped.
 */
function isMoveRedundant(current: Task, destination: MoveTaskArgs): boolean {
    if (destination.projectId !== undefined) {
        return (
            current.projectId === destination.projectId && !current.sectionId && !current.parentId
        )
    }

    if (destination.sectionId !== undefined) {
        return current.sectionId === destination.sectionId && !current.parentId
    }

    return current.parentId === destination.parentId
}

/**
 * Whether the task's own container field already names `destination`, ignoring
 * what a move would do to its other containers.
 *
 * This is the right question only when a caller names several containers at once:
 * a task described as being in both a project and a section it is already in has
 * nothing to move, and the section says the project was descriptive rather than a
 * request to leave the section. On its own, a container is a statement about the
 * task's whole position, which is what `isMoveRedundant` checks.
 */
function matchesCurrentContainer(current: Task, destination: MoveTaskArgs): boolean {
    if (destination.projectId !== undefined) {
        return current.projectId === destination.projectId
    }
    if (destination.sectionId !== undefined) {
        return current.sectionId === destination.sectionId
    }
    return current.parentId === destination.parentId
}

/**
 * Identifies a move destination, so tasks heading to the same place can be
 * collapsed into one request.
 */
function destinationKey(move: MoveTaskArgs): string {
    if (move.projectId !== undefined) {
        return `project:${move.projectId}`
    }
    if (move.sectionId !== undefined) {
        return `section:${move.sectionId}`
    }
    return `parent:${move.parentId}`
}

function toDestinations(request: MoveRequest): MoveTaskArgs[] {
    const destinations: MoveTaskArgs[] = []
    if (request.projectId) {
        destinations.push({ projectId: request.projectId })
    }
    if (request.sectionId) {
        destinations.push({ sectionId: request.sectionId })
    }
    if (request.parentId) {
        destinations.push({ parentId: request.parentId })
    }
    return destinations
}

/**
 * Works out what move, if any, a requested update actually needs.
 *
 * Callers commonly echo a task's whole current shape back when they only meant to
 * edit a field, which would otherwise be read as a relocation. Dropping the
 * containers the task already satisfies means those calls perform no move at all —
 * and a request that names several containers, all but one of them unchanged,
 * resolves to the single real move instead of being rejected as ambiguous.
 *
 * A single container is judged on the whole position it describes, so asking for a
 * task's current project still moves it when that would lift it out of a section.
 * Several containers are judged field by field, so a task described as already
 * being in its project *and* its section is left alone rather than pulled out of
 * that section.
 *
 * @param taskId - Used only to describe the task in error messages.
 * @param request - The container fields as supplied by the caller.
 * @param current - The task's current state, or undefined when it could not be
 *   read. Unknown state means every requested move is performed, matching the
 *   behaviour of not checking at all.
 * @throws If more than one genuine destination remains, since the API accepts
 *   exactly one.
 */
function planMove({
    taskId,
    request,
    current,
}: {
    taskId: string
    request: MoveRequest
    current: Task | undefined
}): MovePlan {
    const requested = toDestinations(request)
    if (requested.length === 0) {
        return { redundantMoveSkipped: false }
    }

    let effective = requested
    let redundantMoveSkipped = false
    if (current) {
        const isSatisfied =
            requested.length === 1
                ? (destination: MoveTaskArgs) => isMoveRedundant(current, destination)
                : (destination: MoveTaskArgs) => matchesCurrentContainer(current, destination)
        effective = requested.filter((destination) => !isSatisfied(destination))
        redundantMoveSkipped = effective.length < requested.length
    }

    if (effective.length === 0) {
        return { redundantMoveSkipped }
    }

    if (effective.length > 1) {
        throw new Error(
            `Task ${taskId}: Only one of projectId, sectionId, or parentId can be specified at a time. The Todoist API requires exactly one destination for move operations.`,
        )
    }

    return { move: effective[0], redundantMoveSkipped }
}

export { destinationKey, isMoveRedundant, type MovePlan, type MoveRequest, planMove }
