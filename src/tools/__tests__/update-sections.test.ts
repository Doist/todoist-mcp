import type { Section, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockSection } from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { updateSections } from '../update-sections.js'

// Mock the Todoist API
const mockTodoistApi = {
    updateSection: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_SECTIONS } = ToolNames

describe(`${UPDATE_SECTIONS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('updating a single section', () => {
        it('should update a section when id and name are provided', async () => {
            const mockApiResponse: Section = {
                id: 'existing-section-123',
                projectId: '6cfCcrrCFg2xP94Q',
                sectionOrder: 1,
                userId: 'test-user',
                addedAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
                archivedAt: null,
                isArchived: false,
                isDeleted: false,
                isCollapsed: false,
                name: 'Updated Section Name',
                description: null,
                url: 'https://todoist.com/sections/existing-section-123',
            }

            mockTodoistApi.updateSection.mockResolvedValue(mockApiResponse)

            const result = await updateSections.execute(
                { sections: [{ id: 'existing-section-123', name: 'Updated Section Name' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateSection).toHaveBeenCalledWith('existing-section-123', {
                name: 'Updated Section Name',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Updated 1 section:')
            expect(textContent).toContain(
                'Updated Section Name (id=existing-section-123, projectId=6cfCcrrCFg2xP94Q)',
            )

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    sections: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'existing-section-123',
                            name: 'Updated Section Name',
                        }),
                    ]),
                    totalCount: 1,
                    updatedSectionIds: ['existing-section-123'],
                }),
            )
        })

        it('should update description only, without a name change', async () => {
            const mockApiResponse = createMockSection({
                id: 'sec-1',
                name: 'Planning',
            })
            mockTodoistApi.updateSection.mockResolvedValue(mockApiResponse)

            await updateSections.execute(
                { sections: [{ id: 'sec-1', description: 'Sprint backlog' }] },
                mockTodoistApi,
            )

            // No `name` is sent when only the description changes.
            expect(mockTodoistApi.updateSection).toHaveBeenCalledWith('sec-1', {
                description: 'Sprint backlog',
            })
        })
    })

    describe('updating multiple sections', () => {
        it('should update multiple sections and return mapped results', async () => {
            const mockSections = [
                createMockSection({
                    id: 'section-1',
                    projectId: 'project-1',
                    name: 'Updated First Section',
                }),
                createMockSection({
                    id: 'section-2',
                    projectId: 'project-1',
                    name: 'Updated Second Section',
                }),
                createMockSection({
                    id: 'section-3',
                    projectId: 'project-2',
                    name: 'Updated Third Section',
                }),
            ]

            const [section1, section2, section3] = mockSections as [Section, Section, Section]
            mockTodoistApi.updateSection
                .mockResolvedValueOnce(section1)
                .mockResolvedValueOnce(section2)
                .mockResolvedValueOnce(section3)

            const result = await updateSections.execute(
                {
                    sections: [
                        { id: 'section-1', name: 'Updated First Section' },
                        { id: 'section-2', name: 'Updated Second Section' },
                        { id: 'section-3', name: 'Updated Third Section' },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly for each section
            expect(mockTodoistApi.updateSection).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.updateSection).toHaveBeenNthCalledWith(1, 'section-1', {
                name: 'Updated First Section',
            })
            expect(mockTodoistApi.updateSection).toHaveBeenNthCalledWith(2, 'section-2', {
                name: 'Updated Second Section',
            })
            expect(mockTodoistApi.updateSection).toHaveBeenNthCalledWith(3, 'section-3', {
                name: 'Updated Third Section',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Updated 3 sections:')
            expect(textContent).toContain(
                'Updated First Section (id=section-1, projectId=project-1)',
            )
            expect(textContent).toContain(
                'Updated Second Section (id=section-2, projectId=project-1)',
            )
            expect(textContent).toContain(
                'Updated Third Section (id=section-3, projectId=project-2)',
            )

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    sections: expect.arrayContaining([
                        expect.objectContaining({ id: 'section-1', name: 'Updated First Section' }),
                        expect.objectContaining({
                            id: 'section-2',
                            name: 'Updated Second Section',
                        }),
                        expect.objectContaining({ id: 'section-3', name: 'Updated Third Section' }),
                    ]),
                    totalCount: 3,
                    updatedSectionIds: ['section-1', 'section-2', 'section-3'],
                }),
            )
        })

        it('should handle sections from the same project', async () => {
            const mockSections = [
                createMockSection({
                    id: 'section-1',
                    projectId: 'same-project',
                    name: 'Backlog',
                }),
                createMockSection({
                    id: 'section-2',
                    projectId: 'same-project',
                    name: 'Done',
                }),
            ]

            const [section1, section2] = mockSections as [Section, Section]
            mockTodoistApi.updateSection
                .mockResolvedValueOnce(section1)
                .mockResolvedValueOnce(section2)

            const result = await updateSections.execute(
                {
                    sections: [
                        { id: 'section-1', name: 'Backlog' },
                        { id: 'section-2', name: 'Done' },
                    ],
                },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Updated 2 sections:')
        })
    })

    describe('error handling', () => {
        it('should propagate API errors', async () => {
            const apiError = new Error('API Error: Section not found')
            mockTodoistApi.updateSection.mockRejectedValue(apiError)

            await expect(
                updateSections.execute(
                    { sections: [{ id: 'nonexistent', name: 'New Name' }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Section not found')
        })

        it('should handle partial failures in multiple sections', async () => {
            const mockSection = createMockSection({
                id: 'section-1',
                projectId: 'project-1',
                name: 'Updated Section',
            })

            mockTodoistApi.updateSection
                .mockResolvedValueOnce(mockSection)
                .mockRejectedValueOnce(new Error('API Error: Section not found'))

            await expect(
                updateSections.execute(
                    {
                        sections: [
                            { id: 'section-1', name: 'Updated Section' },
                            { id: 'nonexistent', name: 'New Name' },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Section not found')
        })
    })
})
