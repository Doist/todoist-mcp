import type { Section, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockSection, createMockUser, TEST_ERRORS, TEST_IDS } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { findSections } from './find-sections.js'

// Mock the Todoist API
const mockTodoistApi = {
    getSections: vi.fn(),
    searchSections: vi.fn(),
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_SECTIONS, ADD_SECTIONS } = ToolNames

describe(`${FIND_SECTIONS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('listing all sections in a project', () => {
        it('should list all sections when no search parameter is provided', async () => {
            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_1,
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'To Do',
                }),
                createMockSection({
                    id: TEST_IDS.SECTION_2,
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 2,
                    name: 'In Progress',
                }),
                createMockSection({
                    id: 'section-789',
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 3,
                    name: 'Done',
                }),
                createMockSection({
                    id: 'section-999',
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 4,
                    name: 'Backlog Items',
                }),
            ]

            mockTodoistApi.getSections.mockResolvedValue({
                results: mockSections,
                nextCursor: null,
            })

            const result = await findSections.execute(
                { projectId: TEST_IDS.PROJECT_TEST },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getSections).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_TEST,
            })

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Sections in project')
            expect(textContent).toContain('To Do • id=')
            expect(textContent).toContain('In Progress • id=')
            expect(textContent).toContain('Done • id=')
            expect(textContent).toContain('Backlog Items • id=')

            // Verify structured content
            const { structuredContent } = result
            expect(structuredContent.sections).toHaveLength(4)
            expect(structuredContent.totalCount).toBe(4)
            expect(structuredContent.appliedFilters).toEqual({
                projectId: TEST_IDS.PROJECT_TEST,
                searchText: undefined,
            })
        })

        it('should handle project with no sections', async () => {
            mockTodoistApi.getSections.mockResolvedValue({
                results: [],
                nextCursor: null,
            })

            const result = await findSections.execute(
                { projectId: 'empty-project-id' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getSections).toHaveBeenCalledWith({
                projectId: 'empty-project-id',
            })

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Project has no sections yet')
            expect(textContent).toContain(`Use ${ADD_SECTIONS} to create sections`)

            // Verify structured content
            const { structuredContent } = result
            expect(structuredContent.sections).toEqual([]) // Empty arrays are now kept as empty arrays
            expect(structuredContent.totalCount).toBe(0)
        })
    })

    describe('searching sections by name', () => {
        it('should filter sections by search term (case insensitive)', async () => {
            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_2,
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 2,
                    name: 'In Progress',
                }),
                createMockSection({
                    id: 'section-999',
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 4,
                    name: 'Progress Review',
                }),
            ]

            mockTodoistApi.searchSections.mockResolvedValue({
                results: mockSections,
                nextCursor: null,
            })

            const result = await findSections.execute(
                { projectId: TEST_IDS.PROJECT_TEST, searchText: 'progress' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.searchSections).toHaveBeenCalledWith({
                query: '*progress*',
                projectId: TEST_IDS.PROJECT_TEST,
                cursor: null,
                limit: 200, // SECTIONS_MAX
            })

            // Should return both "In Progress" and "Progress Review" (case insensitive partial match)
            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('matching "progress"')
            expect(textContent).toContain('In Progress • id=')
            expect(textContent).toContain('Progress Review • id=')
        })

        it('should handle search with no matches', async () => {
            mockTodoistApi.searchSections.mockResolvedValue({ results: [], nextCursor: null })

            const result = await findSections.execute(
                { projectId: TEST_IDS.PROJECT_TEST, searchText: 'nonexistent' },
                mockTodoistApi,
            )

            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('Try broader search terms')
            expect(textContent).toContain('Check spelling')
            expect(textContent).toContain('Remove searchText to see all sections')
        })

        it('should handle case sensitive search correctly', async () => {
            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_1,
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'Important Tasks',
                }),
            ]

            mockTodoistApi.searchSections.mockResolvedValue({
                results: mockSections,
                nextCursor: null,
            })

            const result = await findSections.execute(
                { projectId: TEST_IDS.PROJECT_TEST, searchText: 'IMPORTANT' },
                mockTodoistApi,
            )

            // Should match despite different case
            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('matching "IMPORTANT"')
            expect(textContent).toContain('Important Tasks • id=')
        })

        it('should handle partial matches correctly', async () => {
            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_1,
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'Development Tasks',
                }),
                createMockSection({
                    id: TEST_IDS.SECTION_2,
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 2,
                    name: 'Testing Tasks',
                }),
            ]

            mockTodoistApi.searchSections.mockResolvedValue({
                results: mockSections,
                nextCursor: null,
            })

            const result = await findSections.execute(
                { projectId: TEST_IDS.PROJECT_TEST, searchText: 'task' },
                mockTodoistApi,
            )

            // Should match both sections with "task" in the name
            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('matching "task"')
            expect(textContent).toContain('Development Tasks • id=')
            expect(textContent).toContain('Testing Tasks • id=')
        })

        it('should handle exact matches', async () => {
            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_1,
                    projectId: TEST_IDS.PROJECT_TEST,
                    name: 'Done',
                }),
                createMockSection({
                    id: TEST_IDS.SECTION_2,
                    projectId: TEST_IDS.PROJECT_TEST,
                    sectionOrder: 2,
                    name: 'Done Soon',
                }),
            ]

            mockTodoistApi.searchSections.mockResolvedValue({
                results: mockSections,
                nextCursor: null,
            })

            const result = await findSections.execute(
                { projectId: TEST_IDS.PROJECT_TEST, searchText: 'done' },
                mockTodoistApi,
            )

            // Should match both sections containing "done"
            const { textContent } = result
            expect(textContent).toMatchSnapshot()
            expect(textContent).toContain('matching "done"')
            expect(textContent).toContain('Done • id=')
            expect(textContent).toContain('Done Soon • id=')
        })
    })

    describe('inbox project ID resolution', () => {
        it('should resolve "inbox" to actual inbox project ID', async () => {
            const mockUser = createMockUser({
                inboxProjectId: TEST_IDS.PROJECT_INBOX,
            })
            const mockSections: Section[] = [
                createMockSection({
                    id: TEST_IDS.SECTION_1,
                    projectId: TEST_IDS.PROJECT_INBOX,
                    name: 'Inbox Section 1',
                }),
                createMockSection({
                    id: TEST_IDS.SECTION_2,
                    projectId: TEST_IDS.PROJECT_INBOX,
                    name: 'Inbox Section 2',
                    sectionOrder: 2,
                }),
            ]

            // Mock getUser to return our mock user with inbox ID
            mockTodoistApi.getUser.mockResolvedValue(mockUser)

            // Mock the API response
            mockTodoistApi.getSections.mockResolvedValue({
                results: mockSections,
                nextCursor: null,
            })

            const result = await findSections.execute({ projectId: 'inbox' }, mockTodoistApi)

            // Verify getUser was called to resolve inbox
            expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(1)

            // Verify getSections was called with resolved inbox project ID
            expect(mockTodoistApi.getSections).toHaveBeenCalledWith({
                projectId: TEST_IDS.PROJECT_INBOX,
            })

            // Verify result contains the sections
            const { textContent } = result
            expect(textContent).toContain('Sections in project')
            expect(textContent).toContain('Inbox Section 1')
            expect(textContent).toContain('Inbox Section 2')

            // Verify structured content
            const { structuredContent } = result
            expect(structuredContent.totalCount).toBe(2)
            expect(structuredContent.sections).toEqual([
                { id: TEST_IDS.SECTION_1, name: 'Inbox Section 1' },
                { id: TEST_IDS.SECTION_2, name: 'Inbox Section 2' },
            ])
        })
    })

    describe('error handling', () => {
        it.each([
            { error: 'API Error: Project not found', projectId: 'non-existent-project' },
            { error: TEST_ERRORS.API_UNAUTHORIZED, projectId: 'restricted-project' },
            { error: 'API Error: Invalid project ID format', projectId: 'invalid-id-format' },
        ])('should propagate $error', async ({ error, projectId }) => {
            mockTodoistApi.getSections.mockRejectedValue(new Error(error))
            await expect(findSections.execute({ projectId }, mockTodoistApi)).rejects.toThrow(error)
        })
    })
})
