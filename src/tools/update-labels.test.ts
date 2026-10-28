import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { createMockLabel, TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { updateLabels } from './update-labels.js'

const mockTodoistApi = {
    updateLabel: vi.fn(),
    renameSharedLabel: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_LABELS } = ToolNames

describe(`${UPDATE_LABELS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('personal labels', () => {
        it('should update name and return text + structured output', async () => {
            mockTodoistApi.updateLabel.mockResolvedValue(
                createMockLabel({ id: 'label-1', name: 'Renamed' }),
            )

            const result = await updateLabels.execute(
                {
                    labels: [{ labelType: 'personal', id: 'label-1', name: 'Renamed' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLabel).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.updateLabel).toHaveBeenCalledWith('label-1', {
                name: 'Renamed',
            })
            expect(result.structuredContent.updatedLabels).toHaveLength(1)
            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                renameCount: 0,
                skippedCount: 0,
                failureCount: 0,
            })
            expect(result.textContent).toContain('Updated 1 label')
            expect(result.textContent).toContain('Renamed')
        })

        it('should update color, order, and isFavorite together', async () => {
            mockTodoistApi.updateLabel.mockResolvedValue(
                createMockLabel({
                    id: 'label-1',
                    name: 'Work',
                    color: 'blue',
                    order: 7,
                    isFavorite: true,
                }),
            )

            await updateLabels.execute(
                {
                    labels: [
                        {
                            labelType: 'personal',
                            id: 'label-1',
                            color: 'blue',
                            order: 7,
                            isFavorite: true,
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLabel).toHaveBeenCalledWith('label-1', {
                color: 'blue',
                order: 7,
                isFavorite: true,
            })
        })

        it('should update multiple personal labels in one call', async () => {
            mockTodoistApi.updateLabel
                .mockResolvedValueOnce(createMockLabel({ id: 'label-1', name: 'A2' }))
                .mockResolvedValueOnce(createMockLabel({ id: 'label-2', name: 'B2' }))

            const result = await updateLabels.execute(
                {
                    labels: [
                        { labelType: 'personal', id: 'label-1', name: 'A2' },
                        { labelType: 'personal', id: 'label-2', name: 'B2' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLabel).toHaveBeenCalledTimes(2)
            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.structuredContent.appliedOperations.updateCount).toBe(2)
        })

        it('should skip personal label when no fields are provided', async () => {
            const result = await updateLabels.execute(
                { labels: [{ labelType: 'personal', id: 'label-1' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLabel).not.toHaveBeenCalled()
            expect(result.structuredContent.updatedLabels).toHaveLength(0)
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 0,
                renameCount: 0,
                skippedCount: 1,
                failureCount: 0,
            })
            expect(result.textContent).toContain('skipped - no changes')
        })

        it('should report API errors from updateLabel as failures', async () => {
            mockTodoistApi.updateLabel.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            const result = await updateLabels.execute(
                { labels: [{ labelType: 'personal', id: 'label-1', name: 'X' }] },
                mockTodoistApi,
            )

            expect(result.structuredContent.updatedLabels).toEqual([])
            expect(result.structuredContent.failures).toEqual([
                { item: 'label-1', error: TEST_ERRORS.API_UNAUTHORIZED },
            ])
            expect(result.structuredContent.appliedOperations.failureCount).toBe(1)
        })

        it('should keep the other updates when one label in the batch fails', async () => {
            mockTodoistApi.updateLabel
                .mockResolvedValueOnce(createMockLabel({ id: 'label-1', name: 'Work' }))
                .mockRejectedValueOnce(new Error(TEST_ERRORS.API_UNAUTHORIZED))
            mockTodoistApi.renameSharedLabel.mockRejectedValueOnce(
                new Error(TEST_ERRORS.API_UNAUTHORIZED),
            )

            const result = await updateLabels.execute(
                {
                    labels: [
                        { labelType: 'personal', id: 'label-1', name: 'Work' },
                        { labelType: 'personal', id: 'label-2', name: 'Home' },
                        { labelType: 'shared', name: 'team', newName: 'squad' },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent.updatedLabels.map((label) => label.id)).toEqual([
                'label-1',
            ])
            expect(result.structuredContent.failures).toEqual([
                { item: 'label-2', error: TEST_ERRORS.API_UNAUTHORIZED },
                { item: 'team', error: TEST_ERRORS.API_UNAUTHORIZED },
            ])
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                renameCount: 0,
                skippedCount: 0,
                failureCount: 2,
            })
            expect(result.textContent).toContain('Failed (2) - address or drop these items')
        })

        it('retries a transient 5xx failure on a per-label call', async () => {
            vi.useFakeTimers()
            try {
                mockTodoistApi.updateLabel
                    .mockRejectedValueOnce(
                        Object.assign(new Error('Service Unavailable'), { httpStatusCode: 503 }),
                    )
                    .mockResolvedValueOnce(createMockLabel({ id: 'label-1' }))

                const promise = updateLabels.execute(
                    { labels: [{ labelType: 'personal', id: 'label-1', name: 'X' }] },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.updateLabel).toHaveBeenCalledTimes(2)
                expect(result.structuredContent.appliedOperations.failureCount).toBe(0)
            } finally {
                vi.useRealTimers()
            }
        })

        it('should normalize a display color name to canonical key', async () => {
            mockTodoistApi.updateLabel.mockResolvedValue(
                createMockLabel({ id: 'label-1', color: 'berry_red' }),
            )

            const parsed = z.object(updateLabels.parameters).parse({
                labels: [{ labelType: 'personal', id: 'label-1', color: 'Berry Red' }],
            })
            await updateLabels.execute(parsed, mockTodoistApi)

            expect(mockTodoistApi.updateLabel).toHaveBeenCalledWith(
                'label-1',
                expect.objectContaining({ color: 'berry_red' }),
            )
        })
    })

    describe('shared labels', () => {
        it('should rename a shared label', async () => {
            mockTodoistApi.renameSharedLabel.mockResolvedValue(true)

            const result = await updateLabels.execute(
                {
                    labels: [{ labelType: 'shared', name: 'old', newName: 'new' }],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.renameSharedLabel).toHaveBeenCalledWith({
                name: 'old',
                newName: 'new',
            })
            expect(result.structuredContent.renamedSharedLabels).toEqual([
                { name: 'old', newName: 'new' },
            ])
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 0,
                renameCount: 1,
                skippedCount: 0,
                failureCount: 0,
            })
            expect(result.textContent).toContain('old → new')
        })

        it('should mark a shared rename as skipped when API returns false', async () => {
            mockTodoistApi.renameSharedLabel.mockResolvedValue(false)

            const result = await updateLabels.execute(
                {
                    labels: [{ labelType: 'shared', name: 'missing', newName: 'whatever' }],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent.renamedSharedLabels).toHaveLength(0)
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 0,
                renameCount: 0,
                skippedCount: 1,
                failureCount: 0,
            })
            expect(result.textContent).toContain('shared label not found')
        })
    })

    describe('mixed batch', () => {
        it('should handle personal updates and shared renames in one call', async () => {
            mockTodoistApi.updateLabel.mockResolvedValue(
                createMockLabel({ id: 'label-1', name: 'P2' }),
            )
            mockTodoistApi.renameSharedLabel.mockResolvedValue(true)

            const result = await updateLabels.execute(
                {
                    labels: [
                        { labelType: 'personal', id: 'label-1', name: 'P2' },
                        { labelType: 'shared', name: 's1', newName: 's2' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateLabel).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.renameSharedLabel).toHaveBeenCalledTimes(1)
            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.structuredContent.appliedOperations).toEqual({
                updateCount: 1,
                renameCount: 1,
                skippedCount: 0,
                failureCount: 0,
            })
            expect(result.textContent).toContain('Personal:')
            expect(result.textContent).toContain('Shared:')
        })
    })

    describe('schema validation', () => {
        const ParamsSchema = z.object(updateLabels.parameters)

        it('should reject personal update without id', () => {
            const parsed = ParamsSchema.safeParse({
                labels: [{ labelType: 'personal', name: 'X' }],
            })
            expect(parsed.success).toBe(false)
        })

        it('should reject shared update without newName', () => {
            const parsed = ParamsSchema.safeParse({
                labels: [{ labelType: 'shared', name: 'foo' }],
            })
            expect(parsed.success).toBe(false)
        })

        it('should reject items without labelType discriminator', () => {
            const parsed = ParamsSchema.safeParse({
                labels: [{ id: 'label-1', name: 'X' }],
            })
            expect(parsed.success).toBe(false)
        })

        it('should reject empty labels array', () => {
            const parsed = ParamsSchema.safeParse({ labels: [] })
            expect(parsed.success).toBe(false)
        })
    })
})
