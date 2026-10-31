import { generateNKeysBetween } from 'fractional-indexing'

/** One entity in a list of siblings that Todoist orders by fractional-indexing key. */
type OrderedSibling = {
    id: string
    /** The entity's order key, or null where Todoist has not assigned one yet. */
    key: string | null
    /** The legacy integer order, used to sort the siblings when any of them has no key. */
    legacyOrder: number
}

/** Where one sibling should end up: a 0-based position in the reordered list. */
type Placement = {
    id: string
    position: number
}

/**
 * Works out the order keys that put each placed sibling at its requested position.
 *
 * Positions are 0-based indexes into the list as it reads after the reorder, and
 * one past the end (or beyond) appends. Placements are applied lowest position
 * first, so several can be given at once and each lands where it asked. Placements
 * that ask for the same position are kept together, in the order they were given.
 *
 * Only placed siblings get new keys: each run of them is keyed between the
 * unplaced neighbours around it, so every other sibling keeps its key. A placed
 * sibling whose key already sits in the right place keeps it too, so repeating a
 * reorder writes nothing. When the existing keys cannot anchor a placement (a
 * sibling has no key yet, or two share one), the whole list is re-keyed in its
 * new order instead.
 *
 * Keys compare by UTF-16 code unit, as Todoist sorts them, never by locale.
 *
 * @returns The new key for each sibling whose key must change.
 */
function computeOrderKeys(
    siblings: readonly OrderedSibling[],
    placements: readonly Placement[],
): Map<string, string> {
    const byId = new Map(siblings.map((sibling) => [sibling.id, sibling]))
    const placedIds = new Set(placements.map((placement) => placement.id))
    for (const id of placedIds) {
        if (!byId.has(id)) {
            throw new Error(`Sibling id=${id} is not in the list being reordered`)
        }
    }

    const allKeyed = siblings.every((sibling) => sibling.key !== null)
    const current = [...siblings].sort(allKeyed ? compareByKey : compareByLegacyOrder)

    const reordered = current.filter((sibling) => !placedIds.has(sibling.id))
    const byPosition = [...placements].sort((a, b) => a.position - b.position)
    let previous: { position: number; index: number } | undefined
    for (const { id, position } of byPosition) {
        const sibling = byId.get(id)
        if (!sibling) continue
        const target = previous?.position === position ? previous.index + 1 : position
        const index = Math.min(target, reordered.length)
        reordered.splice(index, 0, sibling)
        previous = { position, index }
    }

    if (!allKeyed || !anchorsAscend(reordered, placedIds)) {
        return rekeyAll(reordered)
    }

    const newKeys = new Map<string, string>()
    let run: OrderedSibling[] = []
    let previousKey: string | null = null
    for (const sibling of reordered) {
        if (placedIds.has(sibling.id)) {
            run.push(sibling)
            continue
        }
        keyRun(run, previousKey, sibling.key, newKeys)
        run = []
        previousKey = sibling.key
    }
    keyRun(run, previousKey, null, newKeys)
    return newKeys
}

/** Keys a run of placed siblings between two anchors, unless their keys already fit. */
function keyRun(
    run: readonly OrderedSibling[],
    lower: string | null,
    upper: string | null,
    newKeys: Map<string, string>,
): void {
    if (run.length === 0 || keysFitBetween(run, lower, upper)) {
        return
    }
    const keys = generateNKeysBetween(lower, upper, run.length)
    run.forEach((sibling, index) => {
        const key = keys[index]
        if (key !== undefined && key !== sibling.key) {
            newKeys.set(sibling.id, key)
        }
    })
}

function keysFitBetween(
    run: readonly OrderedSibling[],
    lower: string | null,
    upper: string | null,
): boolean {
    let previous = lower
    for (const { key } of run) {
        if (key === null || (previous !== null && key <= previous)) {
            return false
        }
        previous = key
    }
    return upper === null || (previous !== null && previous < upper)
}

/** Whether the unplaced siblings' keys strictly ascend, so there is room between each pair. */
function anchorsAscend(reordered: readonly OrderedSibling[], placedIds: Set<string>): boolean {
    let previous: string | null = null
    for (const { id, key } of reordered) {
        if (placedIds.has(id)) {
            continue
        }
        if (key === null || (previous !== null && key <= previous)) {
            return false
        }
        previous = key
    }
    return true
}

function rekeyAll(reordered: readonly OrderedSibling[]): Map<string, string> {
    const keys = generateNKeysBetween(null, null, reordered.length)
    const newKeys = new Map<string, string>()
    reordered.forEach((sibling, index) => {
        const key = keys[index]
        if (key !== undefined && key !== sibling.key) {
            newKeys.set(sibling.id, key)
        }
    })
    return newKeys
}

function compareByKey(a: OrderedSibling, b: OrderedSibling): number {
    const aKey = a.key ?? ''
    const bKey = b.key ?? ''
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
}

function compareByLegacyOrder(a: OrderedSibling, b: OrderedSibling): number {
    return a.legacyOrder - b.legacyOrder
}

export { computeOrderKeys }
export type { OrderedSibling, Placement }
