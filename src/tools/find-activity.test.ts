import type { ACTIVITY_EVENT_TYPES, ActivityEvent, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { createMockUser } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { userResolver } from '../utils/user-resolver.js'
import { findActivity } from './find-activity.js'

// Mock the Todoist API. Initiators are named from project collaborators, which
// default to none, so events show the initiator's user ID.
const mockTodoistApi = {
    getActivityLogs: vi.fn(),
    getUser: vi.fn(),
    getProjectCollaborators: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { FIND_ACTIVITY } = ToolNames

/**
 * Helper to create a mock activity event
 */
function createMockActivityEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
    return {
        id: 'event-123',
        objectType: 'task',
        objectId: 'task-456',
        eventType: 'added',
        eventDate: new Date('2024-10-23T10:30:00Z'),
        parentProjectId: 'project-789',
        parentItemId: null,
        initiatorId: 'user-001',
        extraData: null,
        ...overrides,
    }
}

describe(`${FIND_ACTIVITY} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        userResolver.clearCache()
        mockTodoistApi.getUser.mockResolvedValue(createMockUser())
        mockTodoistApi.getProjectCollaborators.mockResolvedValue({ results: [], nextCursor: null })
    })

    describe('basic functionality', () => {
        it('should retrieve activity events with default parameters', async () => {
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    id: 'event-1',
                    eventType: 'added',
                    eventDate: new Date('2024-10-23T10:00:00Z'),
                }),
                createMockActivityEvent({
                    id: 'event-2',
                    eventType: 'completed',
                    eventDate: new Date('2024-10-23T11:00:00Z'),
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, mockTodoistApi)

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                limit: 20,
                cursor: null,
            })

            expect(result.textContent).toMatchSnapshot()
        })

        it('should handle empty results', async () => {
            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: [],
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, mockTodoistApi)

            expect(result.textContent).toMatchSnapshot()
        })

        it('should handle pagination with cursor', async () => {
            const mockEvents: ActivityEvent[] = Array.from({ length: 20 }, (_, i) =>
                createMockActivityEvent({
                    id: `event-${i}`,
                    objectId: `task-${i}`,
                }),
            )

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: 'next-page-cursor',
            })

            const result = await findActivity.execute(
                { limit: 20, cursor: 'current-cursor' },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                limit: 20,
                cursor: 'current-cursor',
            })

            expect(result.textContent).toContain('Pass cursor')
            expect(result.textContent).toContain('next-page-cursor')
        })
    })

    describe('filtering', () => {
        it.each(['dateFrom', 'dateTo'] as const)('should reject non-ISO values for %s', (field) => {
            const result = z.object(findActivity.parameters).safeParse({ [field]: 'tomorrow' })

            expect(result.success).toBe(false)
        })

        it('should accept moved as an event type', () => {
            const result = z.object(findActivity.parameters).safeParse({ eventType: 'moved' })

            expect(result.success).toBe(true)
        })

        it('should normalize empty date filters to undefined', () => {
            const parsed = z.object(findActivity.parameters).parse({ dateFrom: '', dateTo: '' })

            expect(parsed.dateFrom).toBeUndefined()
            expect(parsed.dateTo).toBeUndefined()
        })

        it('should filter activity events by an inclusive/exclusive date range', async () => {
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    eventType: 'completed',
                    eventDate: new Date('2026-08-02T12:00:00-04:00'),
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute(
                {
                    objectType: 'task',
                    eventType: 'completed',
                    dateFrom: '2026-08-02T00:00:00-04:00',
                    dateTo: '2026-08-03T00:00:00-04:00',
                    limit: 20,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                objectEventTypes: 'task:completed',
                dateFrom: '2026-08-02T00:00:00-04:00',
                dateTo: '2026-08-03T00:00:00-04:00',
                limit: 20,
                cursor: null,
            })
            expect(result.textContent).toContain('from: 2026-08-02T00:00:00-04:00')
            expect(result.textContent).toContain('until (exclusive): 2026-08-03T00:00:00-04:00')
        })

        it.each([
            ['task', 'added'],
            ['project', 'updated'],
            ['comment', 'deleted'],
        ])('should filter by object type: %s', async (objectType, eventType) => {
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    objectType: objectType as ActivityEvent['objectType'],
                    eventType: eventType as ActivityEvent['eventType'],
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute(
                { objectType: objectType as 'task' | 'project' | 'comment', limit: 20 },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                objectEventTypes: `${objectType}:`,
                limit: 20,
                cursor: null,
            })

            expect(result.textContent).toContain(objectType)
        })

        it.each([
            ['added', 'task-1'],
            ['completed', 'task-2'],
            ['updated', 'task-3'],
            ['deleted', 'task-4'],
            ['moved', 'task-5'],
        ])('should filter by event type: %s', async (eventType, objectId) => {
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    eventType: eventType as ActivityEvent['eventType'],
                    objectId,
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute(
                {
                    eventType: eventType as (typeof ACTIVITY_EVENT_TYPES)[number],
                    limit: 20,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                objectEventTypes: `:${eventType}`,
                limit: 20,
                cursor: null,
            })

            expect(result.textContent).toContain(eventType)
        })

        it('should send objectType along with objectId', async () => {
            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: [createMockActivityEvent()],
                nextCursor: null,
            })

            await findActivity.execute(
                { objectType: 'task', objectId: 'task-123', limit: 20 },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                objectEventTypes: 'task:',
                objectId: 'task-123',
                limit: 20,
                cursor: null,
            })
        })

        // The API cannot apply objectId without the object's type, and an
        // eventType alone (":completed") names no type.
        it.each([
            ['on its own', {}],
            ['with only eventType', { eventType: 'completed' as const }],
        ])('should reject objectId %s', async (_label, extraArgs) => {
            await expect(
                findActivity.execute(
                    { objectId: 'task-123', limit: 20, ...extraArgs },
                    mockTodoistApi,
                ),
            ).rejects.toThrow('objectId requires objectType')

            expect(mockTodoistApi.getActivityLogs).not.toHaveBeenCalled()
        })

        it.each([
            ['projectId', 'project-abc', { parentProjectId: 'project-abc' }],
            ['taskId', 'parent-task-789', { parentItemId: 'parent-task-789' }],
            ['initiatorId', 'user-alice', { initiatorId: 'user-alice' }],
        ])('should filter by %s', async (filterName, filterId, expectedApiCall) => {
            const mockEvents: ActivityEvent[] = [createMockActivityEvent()]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const args: Record<string, unknown> = { limit: 20 }
            args[filterName] = filterId

            await findActivity.execute(
                args as Parameters<typeof findActivity.execute>[0],
                mockTodoistApi,
            )

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                ...expectedApiCall,
                limit: 20,
                cursor: null,
            })
        })

        it('should support multiple filters simultaneously', async () => {
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    objectType: 'task',
                    eventType: 'completed',
                    parentProjectId: 'project-work',
                    initiatorId: 'user-bob',
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute(
                {
                    objectType: 'task',
                    eventType: 'completed',
                    projectId: 'project-work',
                    initiatorId: 'user-bob',
                    limit: 50,
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getActivityLogs).toHaveBeenCalledWith({
                objectEventTypes: 'task:completed',
                parentProjectId: 'project-work',
                initiatorId: 'user-bob',
                limit: 50,
                cursor: null,
            })

            expect(result.textContent).toMatchSnapshot()
        })
    })

    describe('content extraction', () => {
        it('should extract task content from extraData', async () => {
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    eventType: 'added',
                    extraData: { content: 'Buy groceries' },
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, mockTodoistApi)

            expect(result.textContent).toContain('Buy groceries')
        })

        it('should handle system-generated events with no initiator', async () => {
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    initiatorId: null,
                    eventType: 'completed',
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, mockTodoistApi)

            expect(result.textContent).toContain('system')
        })

        it('should truncate long content', async () => {
            const longContent = 'A'.repeat(100)
            const mockEvents: ActivityEvent[] = [
                createMockActivityEvent({
                    extraData: { content: longContent },
                }),
            ]

            mockTodoistApi.getActivityLogs.mockResolvedValue({
                results: mockEvents,
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, mockTodoistApi)

            expect(result.textContent).toContain('...')
            expect(result.textContent).not.toContain(longContent)
        })
    })

    describe('initiator names', () => {
        function createClientWithCollaborators(
            collaborators: { id: string; name: string; email: string }[],
        ): Mocked<TodoistApi> {
            return {
                getActivityLogs: vi.fn(),
                getUser: vi.fn().mockResolvedValue({ id: 'me', fullName: 'Me', email: 'me@x.com' }),
                getProjectCollaborators: vi
                    .fn()
                    .mockResolvedValue({ results: collaborators, nextCursor: null }),
            } as unknown as Mocked<TodoistApi>
        }

        it('names initiators by short name from the collaborators of the event project', async () => {
            const client = createClientWithCollaborators([
                { id: 'user-001', name: 'Ada Lovelace (OOO Friday)', email: 'ada@example.com' },
            ])
            client.getActivityLogs.mockResolvedValue({
                results: [createMockActivityEvent()],
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, client)

            expect(client.getProjectCollaborators).toHaveBeenCalledWith(
                'project-789',
                expect.objectContaining({ cursor: null }),
            )
            expect(result.textContent).toContain(' • by Ada L.')
            expect(result.textContent).not.toContain('by=user-001')
            expect(result.structuredContent.events[0]?.initiatorId).toBe('user-001')
        })

        it('falls back to the user ID when the initiator is not a collaborator', async () => {
            const client = createClientWithCollaborators([
                { id: 'someone-else', name: 'Grace Hopper', email: 'grace@example.com' },
            ])
            client.getActivityLogs.mockResolvedValue({
                results: [createMockActivityEvent({ initiatorId: 'user-002' })],
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, client)

            expect(result.textContent).toContain(' • by=user-002')
        })

        it('does not look up collaborators for events outside a project or without an initiator', async () => {
            const client = createClientWithCollaborators([])
            client.getActivityLogs.mockResolvedValue({
                results: [
                    createMockActivityEvent({ parentProjectId: null }),
                    createMockActivityEvent({ initiatorId: null }),
                ],
                nextCursor: null,
            })

            const result = await findActivity.execute({ limit: 20 }, client)

            expect(client.getProjectCollaborators).not.toHaveBeenCalled()
            expect(result.textContent).toContain(' • by=user-001')
            expect(result.textContent).toContain(' • system')
        })
    })
})
