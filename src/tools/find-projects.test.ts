import type { ColorKey, TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { ColorOutputSchema } from '../utils/colors.js'
import { ProjectSchema } from '../utils/output-schemas.js'
import {
    createMockApiResponse,
    createMockProject,
    createMockWorkspace,
    createMockWorkspaceProjectSummary,
    TEST_ERRORS,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { findProjects } from './find-projects.js'

// Mock the Todoist API
const mockTodoistApi = {
    getProjects: vi.fn(),
    searchProjects: vi.fn(),
    getArchivedProjects: vi.fn(),
    getWorkspaces: vi.fn(),
    getWorkspaceActiveProjects: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_PROJECTS } = ToolNames

describe(`${FIND_PROJECTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // A user in no workspaces, unless a test says otherwise.
        mockTodoistApi.getWorkspaces.mockResolvedValue([])
    })

    describe('listing all projects', () => {
        it('should list all projects when no search parameter is provided', async () => {
            const mockProjects = [
                createMockProject({
                    id: TEST_IDS.PROJECT_INBOX,
                    name: 'Inbox',
                    color: 'grey',
                    inboxProject: true,
                    childOrder: 0,
                }),
                createMockProject({
                    id: TEST_IDS.PROJECT_TEST,
                    name: 'test-abc123def456-project',
                    color: 'charcoal',
                    childOrder: 1,
                }),
                createMockProject({
                    id: TEST_IDS.PROJECT_WORK,
                    name: 'Work Project',
                    color: 'blue',
                    isFavorite: true,
                    isShared: true,
                    viewStyle: 'board',
                    childOrder: 2,
                    description: 'Important work tasks',
                    canAssignTasks: true,
                }),
            ]

            mockTodoistApi.getProjects.mockResolvedValue(createMockApiResponse(mockProjects))

            const result = await findProjects.execute({ limit: 50 }, mockTodoistApi)

            // Verify API was called correctly
            expect(mockTodoistApi.getProjects).toHaveBeenCalledWith({
                limit: 50,
                cursor: null,
            })

            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    projects: expect.any(Array),
                    totalCount: 3,
                    hasMore: false,
                    appliedFilters: {
                        searchText: undefined,
                        limit: 50,
                        cursor: undefined,
                    },
                }),
            )
            expect(structuredContent.projects).toHaveLength(3)
        })

        it('should handle pagination with limit and cursor', async () => {
            const mockProject = createMockProject({
                id: 'project-1',
                name: 'First Project',
                color: 'red',
            })
            mockTodoistApi.getProjects.mockResolvedValue(
                createMockApiResponse([mockProject], 'next-page-cursor'),
            )

            const result = await findProjects.execute(
                { limit: 10, cursor: 'current-page-cursor' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProjects).toHaveBeenCalledWith({
                limit: 10,
                cursor: 'current-page-cursor',
            })
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent.projects).toHaveLength(1)
            expect(structuredContent.totalCount).toBe(1)
            expect(structuredContent.hasMore).toBe(true)
            expect(structuredContent.nextCursor).toBe('next-page-cursor')
            expect(structuredContent.appliedFilters).toEqual({
                search: undefined,
                limit: 10,
                cursor: 'current-page-cursor',
            })
        })
    })

    describe('searching projects', () => {
        it('should search projects by name (case insensitive)', async () => {
            const matchingProjects = [
                createMockProject({
                    id: TEST_IDS.PROJECT_WORK,
                    name: 'Work Project',
                    color: 'blue',
                }),
                createMockProject({ id: 'hobby-project-id', name: 'Hobby Work', color: 'orange' }),
            ]

            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse(matchingProjects))
            const result = await findProjects.execute(
                { searchText: 'work', limit: 50 },
                mockTodoistApi,
            )

            // When searching, should use maximum limit and ignore user's limit parameter
            expect(mockTodoistApi.searchProjects).toHaveBeenCalledWith({
                query: '*work*',
                limit: 200,
                cursor: null,
            })
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content with search filter
            const structuredContent = result.structuredContent
            expect(structuredContent.projects).toHaveLength(2) // Should match filtered results
            expect(structuredContent.totalCount).toBe(2)
            expect(structuredContent.hasMore).toBe(false) // Always false when searching
            expect(structuredContent.nextCursor).toBeUndefined() // No cursor when searching
            expect(structuredContent.appliedFilters).toEqual({
                searchText: 'work',
                limit: 50,
                cursor: undefined,
            })
        })

        it('should fetch all pages of search results', async () => {
            const page1Projects = [createMockProject({ id: 'work-1', name: 'Work Project 1' })]
            const page2Projects = [
                createMockProject({
                    id: 'work-2',
                    name: 'Important Work Project',
                }),
            ]

            // Set up multiple API calls to simulate pagination
            mockTodoistApi.searchProjects
                .mockResolvedValueOnce(createMockApiResponse(page1Projects, 'page-2-cursor'))
                .mockResolvedValueOnce(createMockApiResponse(page2Projects, null))

            const result = await findProjects.execute(
                { searchText: 'work', limit: 10 },
                mockTodoistApi,
            )

            // Should have made 2 API calls to get all matching projects
            expect(mockTodoistApi.searchProjects).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.searchProjects).toHaveBeenNthCalledWith(1, {
                query: '*work*',
                limit: 200,
                cursor: null,
            })
            expect(mockTodoistApi.searchProjects).toHaveBeenNthCalledWith(2, {
                query: '*work*',
                limit: 200,
                cursor: 'page-2-cursor',
            })

            // Should include results from all pages
            const structuredContent = result.structuredContent
            expect(structuredContent.projects).toHaveLength(2)
            expect(structuredContent.projects[1]?.name).toBe('Important Work Project')
            expect(structuredContent.totalCount).toBe(2)
            expect(structuredContent.hasMore).toBe(false)
            expect(structuredContent.nextCursor).toBeUndefined()
        })

        it.each([
            {
                search: 'nonexistent',
                apiProjects: [],
                expectedCount: 0,
                description: 'no matches',
            },
            {
                search: 'IMPORTANT',
                apiProjects: ['Important Project'],
                expectedCount: 1,
                description: 'case insensitive matching',
            },
        ])(
            'should handle search with $description',
            async ({ search, apiProjects, expectedCount }) => {
                const mockProjects = apiProjects.map((name) => createMockProject({ name }))
                mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse(mockProjects))

                const result = await findProjects.execute(
                    { searchText: search, limit: 50 },
                    mockTodoistApi,
                )
                expect(result.textContent).toMatchSnapshot()

                // Verify structured content
                const structuredContent = result.structuredContent
                expect(structuredContent.projects).toHaveLength(expectedCount)
                expect(structuredContent).toEqual(
                    expect.objectContaining({
                        appliedFilters: expect.objectContaining({ searchText: search }),
                    }),
                )
            },
        )
    })

    describe('unrecognised color values (issue #343)', () => {
        // The Todoist API may return color values not present in the ColorKeySchema enum.
        // Before this fix both failure modes below would occur:
        //   1. Full list  → loud MCP output-validation error (-32602) when the MCP SDK
        //      validates structuredContent against the outputSchema
        //   2. Name search → silent empty result set (swallowed validation error)
        //
        // The unit tests below call tool.execute() directly, so they do not go through the
        // MCP SDK output-validation layer.  Instead they verify:
        //   a. ColorOutputSchema itself tolerates unrecognised values (schema-level tests)
        //   b. The tool returns projects successfully when a project has an unrecognised color
        //      (end-to-end execution tests)

        describe('ColorOutputSchema tolerance', () => {
            it('should coerce an unrecognised color value to undefined', () => {
                expect(ColorOutputSchema.parse('gray')).toBeUndefined()
                expect(ColorOutputSchema.parse('unknown-color')).toBeUndefined()
            })

            it('should pass through recognised color values unchanged', () => {
                expect(ColorOutputSchema.parse('grey')).toBe('grey')
                expect(ColorOutputSchema.parse('blue')).toBe('blue')
                expect(ColorOutputSchema.parse('charcoal')).toBe('charcoal')
            })

            it('should coerce unrecognised colors to undefined in ProjectSchema', () => {
                const project = {
                    id: 'proj-1',
                    name: 'Inbox',
                    description: '',
                    color: 'gray', // unrecognised
                    isFavorite: false,
                    isShared: false,
                    inboxProject: true,
                    viewStyle: 'list',
                    childOrder: 0,
                    isArchived: false,
                }
                // Should parse without throwing
                const parsed = ProjectSchema.parse(project)
                // Unrecognised color coerces to undefined
                expect(parsed.color).toBeUndefined()
            })

            it('should not throw for ProjectSchema when color is unrecognised', () => {
                // Replicates the MCP SDK validation that caused the -32602 error
                const project = {
                    id: 'proj-1',
                    name: 'Inbox',
                    description: '',
                    color: 'gray',
                    isFavorite: false,
                    isShared: false,
                    inboxProject: true,
                    viewStyle: 'list',
                    childOrder: 0,
                    isArchived: false,
                }
                expect(() => ProjectSchema.parse(project)).not.toThrow()
            })
        })

        it('should succeed for a full list when a project has an unrecognised color', async () => {
            // An unrecognised color value should not cause output-validation to throw -32602.
            const mockProjects = [
                createMockProject({
                    id: TEST_IDS.PROJECT_INBOX,
                    name: 'Inbox',
                    color: 'gray' as unknown as ColorKey,
                    inboxProject: true,
                }),
                createMockProject({ id: TEST_IDS.PROJECT_WORK, name: 'Work', color: 'blue' }),
            ]

            mockTodoistApi.getProjects.mockResolvedValue(createMockApiResponse(mockProjects))

            // Should not throw (before the fix, MCP SDK output validation would throw -32602)
            const result = await findProjects.execute({ limit: 50 }, mockTodoistApi)

            // Should return all projects
            expect(result.structuredContent.projects).toHaveLength(2)
            expect(result.structuredContent.totalCount).toBe(2)
        })

        it('should return matching projects when the matching project has an unrecognised color', async () => {
            // Before the fix, the search path would silently swallow the validation error
            // and return { projects: [], totalCount: 0 } — indistinguishable from no match.
            const matchingProject = createMockProject({
                id: TEST_IDS.PROJECT_INBOX,
                name: 'Inbox',
                color: 'gray' as unknown as ColorKey,
                inboxProject: true,
            })

            mockTodoistApi.searchProjects.mockResolvedValue(
                createMockApiResponse([matchingProject]),
            )

            const result = await findProjects.execute(
                { searchText: 'inbox', limit: 50 },
                mockTodoistApi,
            )

            // Should find the project, not silently return an empty result set
            expect(result.structuredContent.projects).toHaveLength(1)
            expect(result.structuredContent.totalCount).toBe(1)
            expect(result.structuredContent.projects[0]?.name).toBe('Inbox')
        })

        it('should return correct results when a non-matching project has an unrecognised color', async () => {
            // Server-side search filters out non-matching projects before returning.
            // Confirms that a recognized-color match is returned correctly even when
            // other projects in the account have unrecognised colors.
            const matchingProject = createMockProject({
                id: TEST_IDS.PROJECT_WORK,
                name: 'Work Project',
                color: 'blue',
            })

            mockTodoistApi.searchProjects.mockResolvedValue(
                createMockApiResponse([matchingProject]),
            )

            const result = await findProjects.execute(
                { searchText: 'work', limit: 50 },
                mockTodoistApi,
            )

            expect(result.structuredContent.projects).toHaveLength(1)
            expect(result.structuredContent.projects[0]?.name).toBe('Work Project')
        })
    })

    describe('archived projects', () => {
        it("should list only archived projects when archivedStatus is 'archived'", async () => {
            const archivedProjects = [
                createMockProject({
                    id: 'archived-1',
                    name: 'Old Project',
                    isArchived: true,
                }),
            ]
            mockTodoistApi.getArchivedProjects.mockResolvedValue(
                createMockApiResponse(archivedProjects),
            )

            const result = await findProjects.execute(
                { limit: 50, archivedStatus: 'archived' },
                mockTodoistApi,
            )

            // Uses the archived endpoint, never the active one
            expect(mockTodoistApi.getArchivedProjects).toHaveBeenCalledWith({
                limit: 50,
                cursor: null,
            })
            expect(mockTodoistApi.getProjects).not.toHaveBeenCalled()

            const structuredContent = result.structuredContent
            expect(structuredContent.projects).toHaveLength(1)
            expect(structuredContent.projects[0]?.isArchived).toBe(true)
            expect(structuredContent.totalCount).toBe(1)
        })

        it("should paginate archived projects when archivedStatus is 'archived'", async () => {
            mockTodoistApi.getArchivedProjects.mockResolvedValue(
                createMockApiResponse(
                    [createMockProject({ id: 'archived-1', isArchived: true })],
                    'next-archived-cursor',
                ),
            )

            const result = await findProjects.execute(
                { limit: 10, cursor: 'archived-cursor', archivedStatus: 'archived' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getArchivedProjects).toHaveBeenCalledWith({
                limit: 10,
                cursor: 'archived-cursor',
            })
            expect(result.structuredContent.hasMore).toBe(true)
            expect(result.structuredContent.nextCursor).toBe('next-archived-cursor')
        })

        it("should merge active and archived projects when archivedStatus is 'all'", async () => {
            mockTodoistApi.getProjects.mockResolvedValue(
                createMockApiResponse([
                    createMockProject({ id: 'active-1', name: 'Active', isArchived: false }),
                ]),
            )
            mockTodoistApi.getArchivedProjects.mockResolvedValue(
                createMockApiResponse([
                    createMockProject({ id: 'archived-1', name: 'Archived', isArchived: true }),
                ]),
            )

            const result = await findProjects.execute(
                { limit: 50, archivedStatus: 'all' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getProjects).toHaveBeenCalled()
            expect(mockTodoistApi.getArchivedProjects).toHaveBeenCalled()

            const structuredContent = result.structuredContent
            expect(structuredContent.projects).toHaveLength(2)
            expect(structuredContent.projects.map((p) => p.isArchived).sort()).toEqual([
                false,
                true,
            ])
            // Combined results are not cursor-paginated
            expect(structuredContent.hasMore).toBe(false)
            expect(structuredContent.nextCursor).toBeUndefined()
        })

        it("should filter archived projects by searchText client-side when archivedStatus is 'archived'", async () => {
            mockTodoistApi.getArchivedProjects.mockResolvedValue(
                createMockApiResponse([
                    createMockProject({ id: 'a1', name: 'Work Archive', isArchived: true }),
                    createMockProject({ id: 'a2', name: 'Personal Stuff', isArchived: true }),
                    createMockProject({ id: 'a3', name: 'Old work notes', isArchived: true }),
                ]),
            )

            const result = await findProjects.execute(
                { limit: 50, searchText: 'work', archivedStatus: 'archived' },
                mockTodoistApi,
            )

            // No server-side search for archived; the active search endpoint is not used
            expect(mockTodoistApi.searchProjects).not.toHaveBeenCalled()

            const names = result.structuredContent.projects.map((p) => p.name)
            expect(names).toEqual(['Work Archive', 'Old work notes'])
            expect(result.structuredContent.hasMore).toBe(false)
        })

        it('should support prefix wildcard search for archived projects', async () => {
            mockTodoistApi.getArchivedProjects.mockResolvedValue(
                createMockApiResponse([
                    createMockProject({ id: 'a1', name: 'Work Archive', isArchived: true }),
                    createMockProject({ id: 'a2', name: 'Old work notes', isArchived: true }),
                ]),
            )

            const result = await findProjects.execute(
                { limit: 50, searchText: 'work*', archivedStatus: 'archived' },
                mockTodoistApi,
            )

            // Prefix match: only names starting with "work" (case-insensitive)
            expect(result.structuredContent.projects.map((p) => p.name)).toEqual(['Work Archive'])
        })

        it("should search across both active and archived when archivedStatus is 'all' with searchText", async () => {
            // Active projects use server-side search; archived are filtered client-side.
            mockTodoistApi.searchProjects.mockResolvedValue(
                createMockApiResponse([
                    createMockProject({
                        id: 'active-work',
                        name: 'Active Work',
                        isArchived: false,
                    }),
                ]),
            )
            mockTodoistApi.getArchivedProjects.mockResolvedValue(
                createMockApiResponse([
                    createMockProject({ id: 'arch-work', name: 'Archived Work', isArchived: true }),
                    createMockProject({ id: 'arch-other', name: 'Old notes', isArchived: true }),
                ]),
            )

            const result = await findProjects.execute(
                { limit: 50, searchText: 'work', archivedStatus: 'all' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.searchProjects).toHaveBeenCalledWith({
                query: '*work*',
                limit: 200,
                cursor: null,
            })

            const projects = result.structuredContent.projects
            expect(projects.map((p) => p.name)).toEqual(['Active Work', 'Archived Work'])
            expect(projects.map((p) => p.isArchived)).toEqual([false, true])
            expect(result.structuredContent.hasMore).toBe(false)
        })

        it('should report no archived projects when none exist', async () => {
            mockTodoistApi.getArchivedProjects.mockResolvedValue(createMockApiResponse([]))

            const result = await findProjects.execute(
                { limit: 50, archivedStatus: 'archived' },
                mockTodoistApi,
            )

            expect(result.structuredContent.totalCount).toBe(0)
            expect(result.textContent).toContain('No archived projects')
        })
    })

    describe('workspace projects the user has not joined', () => {
        const salesPipeline = createMockWorkspaceProjectSummary({
            id: 'sales-pipeline-id',
            name: 'Sales Pipeline',
            workspaceId: 'ws-acme',
            url: 'https://app.todoist.com/app/project/sales-pipeline-sales-pipeline-id',
        })
        const roadmap = createMockWorkspaceProjectSummary({
            id: 'roadmap-id',
            name: 'Product Roadmap',
            workspaceId: 'ws-side',
            url: 'https://app.todoist.com/app/project/product-roadmap-roadmap-id',
        })
        const joinedOps = createMockWorkspaceProjectSummary({
            id: 'ops-id',
            name: 'Sales Ops',
            workspaceId: 'ws-acme',
            role: 'READ_WRITE',
        })

        /** One workspace with `count` unjoined projects, named "Team 0" onwards. */
        function mockUnjoinedProjects(count: number) {
            mockTodoistApi.getWorkspaces.mockResolvedValue([createMockWorkspace()])
            mockTodoistApi.getWorkspaceActiveProjects.mockResolvedValue({
                results: Array.from({ length: count }, (_, i) =>
                    createMockWorkspaceProjectSummary({ id: `unjoined-${i}`, name: `Team ${i}` }),
                ),
                nextCursor: null,
                hasMore: false,
            })
        }

        function mockWorkspaceProjects() {
            mockTodoistApi.getWorkspaces.mockResolvedValue([
                createMockWorkspace({ id: 'ws-acme', name: 'Acme' }),
                createMockWorkspace({ id: 'ws-side', name: 'Side Project' }),
            ])
            mockTodoistApi.getWorkspaceActiveProjects.mockImplementation(
                async ({ workspaceId, cursor }) => {
                    if (workspaceId === 'ws-acme') {
                        // Two pages, to prove every page is read.
                        return cursor === 'acme-page-2'
                            ? { results: [joinedOps], nextCursor: null, hasMore: false }
                            : { results: [salesPipeline], nextCursor: 'acme-page-2', hasMore: true }
                    }
                    return { results: [roadmap], nextCursor: null, hasMore: false }
                },
            )
        }

        it('should list unjoined workspace projects when includeUnjoined is set', async () => {
            mockTodoistApi.getProjects.mockResolvedValue(
                createMockApiResponse([createMockProject({ id: 'joined-id', name: 'Inbox' })]),
            )
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, includeUnjoined: true },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getWorkspaceActiveProjects).toHaveBeenCalledWith({
                workspaceId: 'ws-acme',
                cursor: null,
                limit: 200,
            })
            expect(mockTodoistApi.getWorkspaceActiveProjects).toHaveBeenCalledWith({
                workspaceId: 'ws-acme',
                cursor: 'acme-page-2',
                limit: 200,
            })
            expect(result.structuredContent.projects.map((p) => p.id)).toEqual(['joined-id'])
            // The joined "Sales Ops" is left out: it is already in the user's projects.
            expect(result.structuredContent.unjoinedProjects).toEqual([
                {
                    id: 'sales-pipeline-id',
                    name: 'Sales Pipeline',
                    workspaceId: 'ws-acme',
                    url: 'https://app.todoist.com/app/project/sales-pipeline-sales-pipeline-id',
                },
                {
                    id: 'roadmap-id',
                    name: 'Product Roadmap',
                    workspaceId: 'ws-side',
                    url: 'https://app.todoist.com/app/project/product-roadmap-roadmap-id',
                },
            ])
            expect(result.textContent).toMatchSnapshot()
        })

        it('should preview at most 10 unjoined workspace projects in the text', async () => {
            mockTodoistApi.getProjects.mockResolvedValue(createMockApiResponse([]))
            mockUnjoinedProjects(12)

            const result = await findProjects.execute(
                { limit: 50, includeUnjoined: true },
                mockTodoistApi,
            )

            expect(result.structuredContent.unjoinedProjects).toHaveLength(12)
            expect(result.structuredContent.unjoinedHasMore).toBe(false)
            expect(result.textContent).toContain('Team 9 • id=unjoined-9')
            expect(result.textContent).not.toContain('id=unjoined-10')
            expect(result.textContent).toContain('…and 2 more; narrow with searchText')
        })

        it('should return at most limit unjoined workspace projects', async () => {
            mockTodoistApi.getProjects.mockResolvedValue(createMockApiResponse([]))
            mockUnjoinedProjects(12)

            const result = await findProjects.execute(
                { limit: 5, includeUnjoined: true },
                mockTodoistApi,
            )

            expect(result.structuredContent.unjoinedProjects?.map((p) => p.id)).toEqual([
                'unjoined-0',
                'unjoined-1',
                'unjoined-2',
                'unjoined-3',
                'unjoined-4',
            ])
            expect(result.structuredContent.unjoinedHasMore).toBe(true)
            expect(result.textContent).toContain("Workspace projects the user hasn't joined (12):")
            expect(result.textContent).toContain('Team 4 • id=unjoined-4')
            expect(result.textContent).not.toContain('id=unjoined-5')
            expect(result.textContent).toContain('…and 7 more; narrow with searchText')
        })

        it('should filter unjoined workspace projects by searchText', async () => {
            mockTodoistApi.searchProjects.mockResolvedValue(
                createMockApiResponse([createMockProject({ id: 'joined-id', name: 'Product' })]),
            )
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, searchText: 'product', includeUnjoined: true },
                mockTodoistApi,
            )

            expect(result.structuredContent.unjoinedProjects?.map((p) => p.id)).toEqual([
                'roadmap-id',
            ])
        })

        it('should check unjoined workspace projects when a search matches no joined project', async () => {
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, searchText: 'sales pipe' },
                mockTodoistApi,
            )

            expect(result.structuredContent.projects).toEqual([])
            expect(result.structuredContent.unjoinedProjects?.map((p) => p.id)).toEqual([
                'sales-pipeline-id',
            ])
            expect(result.textContent).toMatchSnapshot()
        })

        it('should say when no unjoined workspace project matches an empty search either', async () => {
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, searchText: 'nonexistent' },
                mockTodoistApi,
            )

            expect(result.structuredContent.unjoinedProjects).toEqual([])
            expect(result.textContent).toContain(
                "No workspace project the user hasn't joined matches either",
            )
        })

        it('should not check workspace projects when a search matches a joined project', async () => {
            mockTodoistApi.searchProjects.mockResolvedValue(
                createMockApiResponse([createMockProject({ name: 'Sales' })]),
            )
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, searchText: 'sales' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getWorkspaces).not.toHaveBeenCalled()
            expect(result.structuredContent.unjoinedProjects).toBeUndefined()
        })

        it('should still return the search result when the unjoined check fails', async () => {
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))
            mockTodoistApi.getWorkspaces.mockRejectedValue(new Error('workspaces unavailable'))

            const result = await findProjects.execute(
                { limit: 50, searchText: 'sales pipe' },
                mockTodoistApi,
            )

            expect(result.structuredContent.projects).toEqual([])
            expect(result.structuredContent.unjoinedProjects).toBeUndefined()
            expect(result.textContent).toContain('includeUnjoined')
        })

        it('should fail when includeUnjoined is set and the workspace projects cannot be read', async () => {
            mockTodoistApi.getProjects.mockResolvedValue(createMockApiResponse([]))
            mockTodoistApi.getWorkspaces.mockRejectedValue(new Error('workspaces unavailable'))

            await expect(
                findProjects.execute({ limit: 50, includeUnjoined: true }, mockTodoistApi),
            ).rejects.toThrow('workspaces unavailable')
        })

        it('should list unjoined workspace projects only on the first page', async () => {
            mockTodoistApi.getProjects.mockResolvedValue(createMockApiResponse([]))
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, includeUnjoined: true, cursor: 'page-2' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getWorkspaces).not.toHaveBeenCalled()
            expect(result.structuredContent.unjoinedProjects).toBeUndefined()
        })

        it('should list unjoined workspace projects for a search passed a cursor, which searches ignore', async () => {
            mockTodoistApi.searchProjects.mockResolvedValue(createMockApiResponse([]))
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, searchText: 'sales pipe', includeUnjoined: true, cursor: 'page-2' },
                mockTodoistApi,
            )

            expect(result.structuredContent.unjoinedProjects?.map((p) => p.id)).toEqual([
                'sales-pipeline-id',
            ])
            expect(result.textContent).not.toContain('Set includeUnjoined')
        })

        it("should list unjoined workspace projects for archivedStatus 'all' passed a cursor, which it ignores", async () => {
            mockTodoistApi.getProjects.mockResolvedValue(createMockApiResponse([]))
            mockTodoistApi.getArchivedProjects.mockResolvedValue(createMockApiResponse([]))
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, archivedStatus: 'all', includeUnjoined: true, cursor: 'page-2' },
                mockTodoistApi,
            )

            expect(result.structuredContent.unjoinedProjects?.map((p) => p.id)).toEqual([
                'sales-pipeline-id',
                'roadmap-id',
            ])
        })

        it('should not list unjoined workspace projects for archived projects', async () => {
            mockTodoistApi.getArchivedProjects.mockResolvedValue(createMockApiResponse([]))
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                { limit: 50, includeUnjoined: true, archivedStatus: 'archived' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getWorkspaces).not.toHaveBeenCalled()
            expect(result.structuredContent.unjoinedProjects).toBeUndefined()
        })

        it('should not suggest includeUnjoined for an archived search, which never lists them', async () => {
            mockTodoistApi.getArchivedProjects.mockResolvedValue(createMockApiResponse([]))
            mockWorkspaceProjects()

            const result = await findProjects.execute(
                {
                    limit: 50,
                    searchText: 'sales',
                    archivedStatus: 'archived',
                    includeUnjoined: true,
                },
                mockTodoistApi,
            )

            expect(result.structuredContent.projects).toEqual([])
            expect(result.textContent).not.toContain('includeUnjoined')
        })
    })

    describe('error handling', () => {
        it.each([
            { error: TEST_ERRORS.API_UNAUTHORIZED, params: { limit: 50 } },
            { error: TEST_ERRORS.INVALID_CURSOR, params: { cursor: 'invalid-cursor', limit: 50 } },
        ])('should propagate $error', async ({ error, params }) => {
            mockTodoistApi.getProjects.mockRejectedValue(new Error(error))
            await expect(findProjects.execute(params, mockTodoistApi)).rejects.toThrow(error)
        })
    })
})
