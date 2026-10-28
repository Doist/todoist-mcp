import type { TodoistApi } from '@doist/todoist-sdk'
import { beforeEach, describe, expect, it, type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { LabelSchema } from '../utils/output-schemas.js'
import { createMockLabel, TEST_ERRORS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { addLabels } from './add-labels.js'

const mockTodoistApi = {
    addLabel: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_LABELS } = ToolNames

describe(`${ADD_LABELS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('adding labels', () => {
        it('should add a single label and return text + structured output', async () => {
            const mockLabel = createMockLabel({ id: 'label-1', name: 'Work', color: 'blue' })
            mockTodoistApi.addLabel.mockResolvedValue(mockLabel)

            const result = await addLabels.execute(
                { labels: [{ name: 'Work', color: 'blue' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addLabel).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.addLabel).toHaveBeenCalledWith({ name: 'Work', color: 'blue' })
            expect(result.structuredContent.labels).toHaveLength(1)
            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.labels[0]?.name).toBe('Work')
            expect(result.structuredContent.labels[0]?.id).toBe('label-1')
            expect(result.textContent).toContain('Added 1 label')
            expect(result.textContent).toContain('Work')
            expect(result.textContent).toMatchSnapshot()
        })

        it('should add multiple labels', async () => {
            const mockLabel1 = createMockLabel({ id: 'label-1', name: 'Work' })
            const mockLabel2 = createMockLabel({ id: 'label-2', name: 'Personal', color: 'green' })
            mockTodoistApi.addLabel
                .mockResolvedValueOnce(mockLabel1)
                .mockResolvedValueOnce(mockLabel2)

            const result = await addLabels.execute(
                { labels: [{ name: 'Work' }, { name: 'Personal', color: 'green' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addLabel).toHaveBeenCalledTimes(2)
            expect(result.structuredContent.labels).toHaveLength(2)
            expect(result.structuredContent.totalCount).toBe(2)
            expect(result.textContent).toContain('Added 2 labels')
            expect(result.textContent).toMatchSnapshot()
        })

        it('should map label fields correctly including order and isFavorite', async () => {
            const mockLabel = createMockLabel({
                id: 'label-1',
                name: 'Work',
                color: 'blue',
                order: 5,
                isFavorite: true,
            })
            mockTodoistApi.addLabel.mockResolvedValue(mockLabel)

            const result = await addLabels.execute(
                { labels: [{ name: 'Work', color: 'blue', order: 5, isFavorite: true }] },
                mockTodoistApi,
            )

            const label = result.structuredContent.labels[0]
            expect(label?.id).toBe('label-1')
            expect(label?.name).toBe('Work')
            expect(label?.color).toBe('blue')
            expect(label?.order).toBe(5)
            expect(label?.isFavorite).toBe(true)
        })

        it('should keep the created labels when one in the batch fails', async () => {
            mockTodoistApi.addLabel
                .mockResolvedValueOnce(createMockLabel({ id: 'label-1', name: 'Work' }))
                .mockRejectedValueOnce(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            const result = await addLabels.execute(
                { labels: [{ name: 'Work' }, { name: 'Personal' }] },
                mockTodoistApi,
            )

            const { structuredContent } = result
            expect(structuredContent.labels.map((label) => label.id)).toEqual(['label-1'])
            expect(structuredContent.totalRequested).toBe(2)
            expect(structuredContent.successCount).toBe(1)
            expect(structuredContent.failureCount).toBe(1)
            expect(structuredContent.failures).toEqual([
                { item: 'Personal', error: TEST_ERRORS.API_UNAUTHORIZED },
            ])
            expect(result.textContent).toContain('Added 1 label:')
            expect(result.textContent).toContain('Failed (1) - address or drop these items')
        })

        it('returns structured failures when every label in the batch fails', async () => {
            mockTodoistApi.addLabel.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))

            const result = await addLabels.execute({ labels: [{ name: 'Work' }] }, mockTodoistApi)

            expect(result.structuredContent.labels).toEqual([])
            expect(result.structuredContent.failures).toEqual([
                { item: 'Work', error: TEST_ERRORS.API_UNAUTHORIZED },
            ])
            expect(result.textContent).toContain('Added 0 labels')
        })

        it('does not retry a label that failed with a 502, since it may have been created', async () => {
            mockTodoistApi.addLabel.mockRejectedValueOnce(
                Object.assign(new Error('Bad Gateway'), { httpStatusCode: 502 }),
            )

            const result = await addLabels.execute({ labels: [{ name: 'Work' }] }, mockTodoistApi)

            expect(mockTodoistApi.addLabel).toHaveBeenCalledOnce()
            expect(result.structuredContent.failures).toEqual([
                { item: 'Work', error: 'Bad Gateway (HTTP 502)' },
            ])
        })

        it('retries a transient 5xx failure on a per-label call', async () => {
            vi.useFakeTimers()
            try {
                mockTodoistApi.addLabel
                    .mockRejectedValueOnce(
                        Object.assign(new Error('Service Unavailable'), { httpStatusCode: 503 }),
                    )
                    .mockResolvedValueOnce(createMockLabel({ id: 'label-1', name: 'Work' }))

                const promise = addLabels.execute({ labels: [{ name: 'Work' }] }, mockTodoistApi)
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.addLabel).toHaveBeenCalledTimes(2)
                expect(result.structuredContent.successCount).toBe(1)
                expect(result.structuredContent.failureCount).toBe(0)
            } finally {
                vi.useRealTimers()
            }
        })
    })

    describe('color handling', () => {
        it('should pass a valid color key through to the API', async () => {
            mockTodoistApi.addLabel.mockResolvedValue(
                createMockLabel({ id: 'label-1', name: 'Berry Label', color: 'berry_red' }),
            )

            await addLabels.execute(
                { labels: [{ name: 'Berry Label', color: 'berry_red' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addLabel).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Berry Label', color: 'berry_red' }),
            )
        })

        it('should normalize a display name to the canonical color key', async () => {
            mockTodoistApi.addLabel.mockResolvedValue(
                createMockLabel({ id: 'label-1', name: 'Berry Label', color: 'berry_red' }),
            )

            const parsed = z.object(addLabels.parameters).parse({
                labels: [{ name: 'Berry Label', color: 'Berry Red' }],
            })
            await addLabels.execute(parsed, mockTodoistApi)

            expect(mockTodoistApi.addLabel).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Berry Label', color: 'berry_red' }),
            )
        })

        it('should omit an unrecognized color and not pass it to the API', async () => {
            mockTodoistApi.addLabel.mockResolvedValue(
                createMockLabel({ id: 'label-1', name: 'Colorless Label' }),
            )

            const parsed = z.object(addLabels.parameters).parse({
                labels: [{ name: 'Colorless Label', color: 'hotpink' }],
            })
            await addLabels.execute(parsed, mockTodoistApi)

            const call = mockTodoistApi.addLabel.mock.calls[0]?.[0]
            expect(call).toBeDefined()
            expect(call?.color).toBeUndefined()
        })
    })

    describe('output schema validation', () => {
        it('should produce output that passes strict schema validation', async () => {
            const mockLabel = createMockLabel({ id: 'label-1', name: 'Schema Test' })
            mockTodoistApi.addLabel.mockResolvedValue(mockLabel)

            const result = await addLabels.execute(
                { labels: [{ name: 'Schema Test' }] },
                mockTodoistApi,
            )

            const label = result.structuredContent.labels[0]
            expect(label).toBeDefined()
            if (!label) return

            const allowedKeys = ['id', 'name', 'color', 'order', 'isFavorite']
            const actualKeys = Object.keys(label)
            // Only allowed keys should be present (undefined values are omitted by JSON)
            for (const key of actualKeys) {
                expect(allowedKeys).toContain(key)
            }

            const parseResult = LabelSchema.strict().safeParse(label)
            expect(parseResult.success).toBe(true)
        })
    })
})
