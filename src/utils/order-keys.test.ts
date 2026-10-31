import { generateNKeysBetween } from 'fractional-indexing'
import { describe, expect, it } from 'vitest'
import { computeOrderKeys, type OrderedSibling, type Placement } from './order-keys.js'

/** Applies the new keys and reads the list back the way Todoist sorts it. */
function orderAfter(siblings: OrderedSibling[], placements: Placement[]): string[] {
    const newKeys = computeOrderKeys(siblings, placements)
    return siblings
        .map((sibling) => ({ id: sibling.id, key: newKeys.get(sibling.id) ?? sibling.key ?? '' }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((sibling) => sibling.id)
}

function keyed(...ids: string[]): OrderedSibling[] {
    // Keys deliberately listed out of id order, so sorting by key is what puts them in order.
    const keys = ['a0', 'a1', 'a2', 'a3', 'a4']
    return ids.map((id, index) => ({ id, key: keys[index] ?? null, legacyOrder: index }))
}

describe('computeOrderKeys', () => {
    it.each([
        { position: 0, expected: ['d', 'a', 'b', 'c'] },
        { position: 1, expected: ['a', 'd', 'b', 'c'] },
        { position: 3, expected: ['a', 'b', 'c', 'd'] },
        { position: 99, expected: ['a', 'b', 'c', 'd'] },
    ])('places a sibling at position $position', ({ position, expected }) => {
        expect(orderAfter(keyed('a', 'b', 'c', 'd'), [{ id: 'd', position }])).toEqual(expected)
    })

    it('re-keys only the placed sibling', () => {
        const newKeys = computeOrderKeys(keyed('a', 'b', 'c'), [{ id: 'c', position: 0 }])
        expect([...newKeys.keys()]).toEqual(['c'])
        const key = newKeys.get('c')
        expect(key !== undefined && key < 'a0').toBe(true)
    })

    it('places several siblings at once, each where it asked', () => {
        expect(
            orderAfter(keyed('a', 'b', 'c', 'd', 'e'), [
                { id: 'e', position: 0 },
                { id: 'a', position: 2 },
                { id: 'b', position: 1 },
            ]),
        ).toEqual(['e', 'b', 'a', 'c', 'd'])
    })

    it('keys adjacent placed siblings between the same pair of neighbours', () => {
        const siblings = keyed('a', 'b', 'c', 'd')
        const newKeys = computeOrderKeys(siblings, [
            { id: 'd', position: 1 },
            { id: 'c', position: 2 },
        ])
        expect(
            orderAfter(siblings, [
                { id: 'd', position: 1 },
                { id: 'c', position: 2 },
            ]),
        ).toEqual(['a', 'd', 'c', 'b'])
        for (const key of newKeys.values()) {
            expect(key > 'a0' && key < 'a1').toBe(true)
        }
    })

    it('writes nothing when the sibling is already in place', () => {
        expect(computeOrderKeys(keyed('a', 'b', 'c'), [{ id: 'b', position: 1 }]).size).toBe(0)
    })

    it('compares keys by code unit rather than by locale', () => {
        // 'Zz' sorts before 'a0' by code unit but after it by locale, so the anchors'
        // order, and so the neighbours 'placed' lands between, depends on the comparison.
        const siblings: OrderedSibling[] = [
            { id: 'lower', key: 'a0', legacyOrder: 0 },
            { id: 'upper', key: 'Zz', legacyOrder: 1 },
            { id: 'placed', key: 'a1', legacyOrder: 2 },
        ]
        expect(orderAfter(siblings, [{ id: 'placed', position: 1 }])).toEqual([
            'upper',
            'placed',
            'lower',
        ])
    })

    it('keeps placements that ask for the same position together, in the order given', () => {
        expect(
            orderAfter(keyed('a', 'b', 'c', 'd'), [
                { id: 'd', position: 0 },
                { id: 'c', position: 0 },
            ]),
        ).toEqual(['d', 'c', 'a', 'b'])
    })

    it('only re-keys the siblings that moved when every sibling is placed', () => {
        // With no unplaced anchors the whole list is one run between open ends, which
        // regenerates the same keys for the siblings that kept their place.
        const keys = generateNKeysBetween(null, null, 4)
        const siblings: OrderedSibling[] = ['a', 'b', 'c', 'd'].map((id, index) => ({
            id,
            key: keys[index] ?? null,
            legacyOrder: index,
        }))
        const placements: Placement[] = [
            { id: 'a', position: 0 },
            { id: 'b', position: 1 },
            { id: 'd', position: 2 },
            { id: 'c', position: 3 },
        ]

        const newKeys = computeOrderKeys(siblings, placements)

        expect([...newKeys.keys()].sort()).toEqual(['c', 'd'])
        expect(orderAfter(siblings, placements)).toEqual(['a', 'b', 'd', 'c'])
    })

    it('re-keys the whole list in legacy order when a sibling has no key', () => {
        const siblings: OrderedSibling[] = [
            { id: 'a', key: null, legacyOrder: 1 },
            { id: 'b', key: 'a5', legacyOrder: 2 },
            { id: 'c', key: 'a1', legacyOrder: 3 },
        ]
        const newKeys = computeOrderKeys(siblings, [{ id: 'c', position: 0 }])
        expect(newKeys.size).toBe(3)
        expect(orderAfter(siblings, [{ id: 'c', position: 0 }])).toEqual(['c', 'a', 'b'])
    })

    it('re-keys the whole list when two neighbours share a key', () => {
        const siblings: OrderedSibling[] = [
            { id: 'a', key: 'a1', legacyOrder: 0 },
            { id: 'b', key: 'a1', legacyOrder: 1 },
            { id: 'c', key: 'a2', legacyOrder: 2 },
        ]
        const newKeys = computeOrderKeys(siblings, [{ id: 'c', position: 0 }])
        const finalKeys = siblings.map((sibling) => newKeys.get(sibling.id) ?? sibling.key)
        expect(new Set(finalKeys).size).toBe(3)
        expect(orderAfter(siblings, [{ id: 'c', position: 0 }])).toEqual(['c', 'a', 'b'])
    })

    it('throws when asked to place something that is not a sibling', () => {
        expect(() => computeOrderKeys(keyed('a'), [{ id: 'z', position: 0 }])).toThrow(
            'Sibling id=z is not in the list being reordered',
        )
    })
})
