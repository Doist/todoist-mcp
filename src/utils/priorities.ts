import { z } from 'zod'

export const PRIORITY_VALUES = ['p1', 'p2', 'p3', 'p4'] as const
export type Priority = (typeof PRIORITY_VALUES)[number]

export const PRIORITY_INPUT_DESCRIPTION =
    'Task priority as a string: "p1" (highest), "p2" (high), "p3" (medium), or "p4" (lowest/default). Integers like 1, 2, 3, or 4 are not accepted.'

export const PrioritySchema = z.enum(PRIORITY_VALUES).describe(PRIORITY_INPUT_DESCRIPTION)

export function convertPriorityToNumber(priority: Priority): number {
    // Todoist API uses inverse mapping: p1=4 (highest), p2=3, p3=2, p4=1 (lowest)
    const priorityMap = { p1: 4, p2: 3, p3: 2, p4: 1 }
    return priorityMap[priority]
}

export function convertNumberToPriority(priority: number): Priority | undefined {
    // Convert Todoist API numbers back to our enum
    const numberMap = { 4: 'p1', 3: 'p2', 2: 'p3', 1: 'p4' } as const
    return numberMap[priority as keyof typeof numberMap]
}
