import type { ColorKey, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { LabelSchema } from '../utils/output-schemas.js'
import {
    createMockApiResponse,
    createMockLabel,
    TEST_ERRORS,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { findLabels } from './find-labels.js'

// Mock the Todoist API
const mockTodoistApi = {
    getLabels: vi.fn(),
    getSharedLabels: vi.fn(),
    searchLabels: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_LABELS } = ToolNames

describe(`${FIND_LABELS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Default: no shared labels
        mockTodoistApi.getSharedLabels.mockResolvedValue({ results: [], nextCursor: null })
    })

    describe('listing all labels', () => {
        it('should list all labels when no search parameter is provided', async () => {
            const mockLabels = [
                createMockLabel({ id: 'label-1', name: 'Work', color: 'blue', order: 1 }),
                createMockLabel({
                    id: 'label-2',
                    name: 'Personal',
                    color: 'green',
                    order: 2,
                    isFavorite: true,
                }),
                createMockLabel({ id: 'label-3', name: 'Errands', color: 'orange', order: 3 }),
            ]

            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse(mockLabels))

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(mockTodoistApi.getLabels).toHaveBeenCalledWith({ limit: 50, cursor: null })
            expect(mockTodoistApi.searchLabels).not.toHaveBeenCalled()

            expect(result.textContent).toMatchSnapshot()

            const { structuredContent } = result
            expect(structuredContent.labels).toHaveLength(3)
            expect(structuredContent.totalCount).toBe(3)
            expect(structuredContent.hasMore).toBe(false)
            expect(structuredContent.nextCursor).toBeUndefined()
            expect(structuredContent.appliedFilters).toEqual({
                limit: 50,
                cursor: undefined,
            })
        })

        it('should handle pagination with limit and cursor', async () => {
            const mockLabel = createMockLabel({ id: 'label-1', name: 'Work', color: 'blue' })
            mockTodoistApi.getLabels.mockResolvedValue(
                createMockApiResponse([mockLabel], 'next-page-cursor'),
            )

            const result = await findLabels.execute(
                { limit: 10, cursor: 'current-page-cursor' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getLabels).toHaveBeenCalledWith({
                limit: 10,
                cursor: 'current-page-cursor',
            })

            const { structuredContent } = result
            expect(structuredContent.labels).toHaveLength(1)
            expect(structuredContent.totalCount).toBe(1)
            expect(structuredContent.hasMore).toBe(true)
            expect(structuredContent.nextCursor).toBe('next-page-cursor')
            expect(result.textContent).toMatchSnapshot()
        })

        it('should return empty list when no labels exist', async () => {
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse([]))

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.labels).toHaveLength(0)
            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.structuredContent.hasMore).toBe(false)
            expect(result.textContent).toMatchSnapshot()
        })

        it('should include all label fields in structured content', async () => {
            const mockLabel = createMockLabel({
                id: TEST_IDS.TASK_1,
                name: 'Important',
                color: 'red',
                order: 1,
                isFavorite: true,
            })
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse([mockLabel]))

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.labels[0]).toEqual({
                id: TEST_IDS.TASK_1,
                name: 'Important',
                color: 'red',
                order: 1,
                isFavorite: true,
            })
        })

        it('should coerce order: null to undefined in structured output', async () => {
            const mockLabel = createMockLabel({ id: 'label-1', name: 'Work', order: null })
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse([mockLabel]))

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.labels[0]?.order).toBeUndefined()
        })

        it('should truncate preview to 10 labels and show count for the rest', async () => {
            const mockLabels = Array.from({ length: 13 }, (_, i) =>
                createMockLabel({ id: `label-${i}`, name: `Label ${i}`, order: i }),
            )
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse(mockLabels))

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.labels).toHaveLength(13)
            expect(result.textContent).toContain('…and 3 more')
            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('shared labels', () => {
        it('should include shared labels in structured content and text', async () => {
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse([]))
            mockTodoistApi.getSharedLabels.mockResolvedValue({
                results: ['team-project', 'urgent'],
                nextCursor: null,
            })

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.sharedLabels).toEqual(['team-project', 'urgent'])
            expect(result.textContent).toContain('Shared labels (2): team-project, urgent')
        })

        it('should fetch all pages of shared labels', async () => {
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse([]))
            mockTodoistApi.getSharedLabels
                .mockResolvedValueOnce({ results: ['label-a'], nextCursor: 'page-2' })
                .mockResolvedValueOnce({ results: ['label-b'], nextCursor: null })

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(mockTodoistApi.getSharedLabels).toHaveBeenCalledTimes(2)
            expect(result.structuredContent.sharedLabels).toEqual(['label-a', 'label-b'])
        })

        it('should show "No shared labels." when none exist', async () => {
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse([]))

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.sharedLabels).toEqual([])
            expect(result.textContent).toContain('No shared labels.')
        })

        it('should fetch shared labels in parallel with personal labels', async () => {
            const mockLabel = createMockLabel({ name: 'Work' })
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse([mockLabel]))
            mockTodoistApi.getSharedLabels.mockResolvedValue({
                results: ['shared-work'],
                nextCursor: null,
            })

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            expect(result.structuredContent.labels).toHaveLength(1)
            expect(result.structuredContent.sharedLabels).toEqual(['shared-work'])
        })
    })

    describe('unrecognised color values', () => {
        it('LabelSchema should coerce an unrecognised color to undefined', () => {
            const label = {
                id: 'label-1',
                name: 'Test',
                color: 'hotpink', // not in enum and never will be
                order: 1,
                isFavorite: false,
            }
            const parsed = LabelSchema.parse(label)
            expect(parsed.color).toBeUndefined()
        })

        it('LabelSchema should coerce order: null to undefined', () => {
            const label = {
                id: 'label-1',
                name: 'Test',
                color: 'red',
                order: null,
                isFavorite: false,
            }
            expect(LabelSchema.parse(label).order).toBeUndefined()
        })

        it('LabelSchema should pass through recognised color values unchanged', () => {
            const label = {
                id: 'label-1',
                name: 'Test',
                color: 'red',
                order: 1,
                isFavorite: false,
            }
            const parsed = LabelSchema.parse(label)
            expect(parsed.color).toBe('red')
        })

        it('should return labels successfully when a label has an unrecognised color', async () => {
            const mockLabels = [
                createMockLabel({ id: 'label-1', name: 'Work', color: 'hotpink' as ColorKey }),
                createMockLabel({ id: 'label-2', name: 'Personal', color: 'blue' }),
            ]
            mockTodoistApi.getLabels.mockResolvedValue(createMockApiResponse(mockLabels))

            const result = await findLabels.execute({ limit: 50 }, mockTodoistApi)

            // Should return all labels without crashing
            expect(result.structuredContent.labels).toHaveLength(2)
            expect(result.structuredContent.totalCount).toBe(2)
        })
    })

    describe('searching labels', () => {
        it('should search labels by name', async () => {
            const matchingLabels = [
                createMockLabel({ id: 'label-1', name: 'Work', color: 'blue' }),
                createMockLabel({ id: 'label-2', name: 'Work Home', color: 'green' }),
            ]

            mockTodoistApi.searchLabels.mockResolvedValue(
                createMockApiResponse(matchingLabels, null),
            )

            const result = await findLabels.execute(
                { searchText: 'work', limit: 50 },
                mockTodoistApi,
            )

            expect(mockTodoistApi.searchLabels).toHaveBeenCalledWith({
                query: '*work*',
                limit: 200,
                cursor: null,
            })
            expect(mockTodoistApi.getLabels).not.toHaveBeenCalled()

            const { structuredContent } = result
            expect(structuredContent.labels).toHaveLength(2)
            expect(structuredContent.totalCount).toBe(2)
            expect(structuredContent.hasMore).toBe(false)
            expect(structuredContent.nextCursor).toBeUndefined()
            expect(structuredContent.appliedFilters).toEqual({ searchText: 'work' })
            expect(result.textContent).toMatchSnapshot()
        })

        it('should fetch all pages of search results', async () => {
            const page1Labels = [createMockLabel({ id: 'label-1', name: 'Work' })]
            const page2Labels = [createMockLabel({ id: 'label-2', name: 'Work Home' })]

            mockTodoistApi.searchLabels
                .mockResolvedValueOnce(createMockApiResponse(page1Labels, 'page-2-cursor'))
                .mockResolvedValueOnce(createMockApiResponse(page2Labels, null))

            const result = await findLabels.execute(
                { searchText: 'work', limit: 10 },
                mockTodoistApi,
            )

            expect(mockTodoistApi.searchLabels).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.searchLabels).toHaveBeenNthCalledWith(1, {
                query: '*work*',
                limit: 200,
                cursor: null,
            })
            expect(mockTodoistApi.searchLabels).toHaveBeenNthCalledWith(2, {
                query: '*work*',
                limit: 200,
                cursor: 'page-2-cursor',
            })

            expect(result.structuredContent.labels).toHaveLength(2)
            expect(result.structuredContent.hasMore).toBe(false)
            expect(result.structuredContent.nextCursor).toBeUndefined()
        })

        it('should return empty list when no labels match exact search', async () => {
            mockTodoistApi.searchLabels.mockResolvedValue(createMockApiResponse([]))

            const result = await findLabels.execute(
                { searchText: 'nonexistent', limit: 50 },
                mockTodoistApi,
            )

            expect(result.structuredContent.labels).toHaveLength(0)
            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('error handling', () => {
        it.each([
            { error: TEST_ERRORS.API_UNAUTHORIZED, params: { limit: 50 } },
            { error: TEST_ERRORS.INVALID_CURSOR, params: { cursor: 'invalid-cursor', limit: 50 } },
        ])('should propagate $error', async ({ error, params }) => {
            mockTodoistApi.getLabels.mockRejectedValue(new Error(error))
            await expect(findLabels.execute(params, mockTodoistApi)).rejects.toThrow(error)
        })

        it('should propagate errors from searchLabels', async () => {
            mockTodoistApi.searchLabels.mockRejectedValue(new Error(TEST_ERRORS.API_UNAUTHORIZED))
            await expect(
                findLabels.execute({ searchText: 'work', limit: 50 }, mockTodoistApi),
            ).rejects.toThrow(TEST_ERRORS.API_UNAUTHORIZED)
        })
    })
})
