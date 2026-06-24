import type { ActivityEvent, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { findActivity } from './find-activity.js'

// Mock the Todoist API
const mockTodoistApi = {
    getActivityLogs: vi.fn(),
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
                    eventType: eventType as
                        | 'added'
                        | 'updated'
                        | 'deleted'
                        | 'completed'
                        | 'uncompleted'
                        | 'archived'
                        | 'unarchived'
                        | 'shared'
                        | 'left',
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

        it.each([
            ['objectId', 'task-123', { objectId: 'task-123' }],
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
})
