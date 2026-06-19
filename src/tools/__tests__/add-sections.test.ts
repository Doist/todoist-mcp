import type { Section, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockSection, createMockUser, TEST_IDS } from '../../utils/test-helpers.js'
import { ToolNames } from '../../utils/tool-names.js'
import { addSections } from '../add-sections.js'

// Mock the Todoist API
const mockTodoistApi = {
    addSection: vi.fn(),
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_SECTIONS } = ToolNames

describe(`${ADD_SECTIONS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getUser.mockResolvedValue(createMockUser())
    })

    describe('creating a single section', () => {
        it('should create a section and return mapped result', async () => {
            const mockApiResponse = createMockSection({
                id: TEST_IDS.SECTION_1,
                projectId: TEST_IDS.PROJECT_TEST,
                name: 'test-abc123def456-section',
            })

            mockTodoistApi.addSection.mockResolvedValue(mockApiResponse)

            const result = await addSections.execute(
                {
                    sections: [
                        { name: 'test-abc123def456-section', projectId: TEST_IDS.PROJECT_TEST },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly
            expect(mockTodoistApi.addSection).toHaveBeenCalledWith({
                name: 'test-abc123def456-section',
                projectId: TEST_IDS.PROJECT_TEST,
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 1 section:')
            expect(textContent).toContain('test-abc123def456-section')
            expect(textContent).toContain(`id=${TEST_IDS.SECTION_1}`)

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    sections: [
                        expect.objectContaining({
                            id: TEST_IDS.SECTION_1,
                            name: 'test-abc123def456-section',
                        }),
                    ],
                    totalCount: 1,
                }),
            )
        })

        it('should handle different section properties from API', async () => {
            const mockApiResponse = createMockSection({
                id: TEST_IDS.SECTION_2,
                projectId: 'project-789',
                sectionOrder: 2,
                name: 'My Section Name',
            })

            mockTodoistApi.addSection.mockResolvedValue(mockApiResponse)

            const result = await addSections.execute(
                { sections: [{ name: 'My Section Name', projectId: 'project-789' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addSection).toHaveBeenCalledWith({
                name: 'My Section Name',
                projectId: 'project-789',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 1 section:')
            expect(textContent).toContain('My Section Name')
            expect(textContent).toContain(`id=${TEST_IDS.SECTION_2}`)
        })
    })

    describe('creating multiple sections', () => {
        it('should create multiple sections and return mapped results', async () => {
            const mockSections = [
                createMockSection({
                    id: 'section-1',
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'First Section',
                }),
                createMockSection({
                    id: 'section-2',
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'Second Section',
                }),
                createMockSection({
                    id: 'section-3',
                    projectId: 'different-project',
                    name: 'Third Section',
                }),
            ]

            const [section1, section2, section3] = mockSections as [Section, Section, Section]
            mockTodoistApi.addSection
                .mockResolvedValueOnce(section1)
                .mockResolvedValueOnce(section2)
                .mockResolvedValueOnce(section3)

            const result = await addSections.execute(
                {
                    sections: [
                        { name: 'First Section', projectId: TEST_IDS.PROJECT_TEST },
                        { name: 'Second Section', projectId: TEST_IDS.PROJECT_TEST },
                        { name: 'Third Section', projectId: 'different-project' },
                    ],
                },
                mockTodoistApi,
            )

            // Verify API was called correctly for each section
            expect(mockTodoistApi.addSection).toHaveBeenCalledTimes(3)
            expect(mockTodoistApi.addSection).toHaveBeenNthCalledWith(1, {
                name: 'First Section',
                projectId: TEST_IDS.PROJECT_TEST,
            })
            expect(mockTodoistApi.addSection).toHaveBeenNthCalledWith(2, {
                name: 'Second Section',
                projectId: TEST_IDS.PROJECT_TEST,
            })
            expect(mockTodoistApi.addSection).toHaveBeenNthCalledWith(3, {
                name: 'Third Section',
                projectId: 'different-project',
            })

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 3 sections:')
            expect(textContent).toContain('First Section (id=section-1, projectId=')
            expect(textContent).toContain('Second Section (id=section-2, projectId=')
            expect(textContent).toContain(
                'Third Section (id=section-3, projectId=different-project)',
            )

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    sections: expect.arrayContaining([
                        expect.objectContaining({ id: 'section-1', name: 'First Section' }),
                        expect.objectContaining({ id: 'section-2', name: 'Second Section' }),
                        expect.objectContaining({ id: 'section-3', name: 'Third Section' }),
                    ]),
                    totalCount: 3,
                }),
            )
        })

        it('should handle sections for the same project', async () => {
            const mockSections = [
                createMockSection({
                    id: 'section-1',
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'To Do',
                }),
                createMockSection({
                    id: 'section-2',
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'In Progress',
                }),
            ]

            const [section1, section2] = mockSections as [Section, Section]
            mockTodoistApi.addSection
                .mockResolvedValueOnce(section1)
                .mockResolvedValueOnce(section2)

            const result = await addSections.execute(
                {
                    sections: [
                        { name: 'To Do', projectId: TEST_IDS.PROJECT_TEST },
                        { name: 'In Progress', projectId: TEST_IDS.PROJECT_TEST },
                    ],
                },
                mockTodoistApi,
            )

            const textContent = result.textContent
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Added 2 sections:')
        })
    })

    describe('error handling', () => {
        it('should propagate API errors', async () => {
            const apiError = new Error('API Error: Section name is required')
            mockTodoistApi.addSection.mockRejectedValue(apiError)

            await expect(
                addSections.execute(
                    { sections: [{ name: '', projectId: TEST_IDS.PROJECT_TEST }] },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('API Error: Section name is required')
        })

        it('should keep successful sections when one in the batch fails', async () => {
            const mockSection = createMockSection({
                id: 'section-1',
                projectId: TEST_IDS.PROJECT_TEST,
                name: 'First Section',
            })

            mockTodoistApi.addSection
                .mockResolvedValueOnce(mockSection)
                .mockRejectedValueOnce(new Error('API Error: Invalid project ID'))

            const result = await addSections.execute(
                {
                    sections: [
                        { name: 'First Section', projectId: TEST_IDS.PROJECT_TEST },
                        { name: 'Second Section', projectId: 'invalid-project' },
                    ],
                },
                mockTodoistApi,
            )

            // The successful section is preserved instead of being discarded by the failure.
            const { structuredContent } = result
            expect(structuredContent.sections).toHaveLength(1)
            expect(structuredContent.totalCount).toBe(1)
            expect(structuredContent.successCount).toBe(1)
            expect(structuredContent.totalRequested).toBe(2)

            // The failure is reported per-item with the offending section identified by name.
            expect(structuredContent.failureCount).toBe(1)
            expect(structuredContent.failures).toHaveLength(1)
            expect(structuredContent.failures[0]?.item).toBe('Second Section')
            expect(structuredContent.failures[0]?.error).toContain('API Error: Invalid project ID')

            expect(result.textContent).toContain('Added 1 section:')
            expect(result.textContent).toContain('Failed (1)')
            expect(result.textContent).toContain('not retried automatically')
        })

        it('should throw when every section in the batch fails', async () => {
            mockTodoistApi.addSection
                .mockRejectedValueOnce(new Error('API Error: Invalid project ID'))
                .mockRejectedValueOnce(new Error('API Error: Invalid project ID'))

            await expect(
                addSections.execute(
                    {
                        sections: [
                            { name: 'First Section', projectId: 'invalid-1' },
                            { name: 'Second Section', projectId: 'invalid-2' },
                        ],
                    },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('All 2 section(s) failed to create')
        })
    })
})
