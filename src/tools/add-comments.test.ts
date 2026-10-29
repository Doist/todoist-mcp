import type { Comment, Task, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { z } from 'zod'
import { ApiLimits } from '../utils/constants.js'
import { createMockTask, createMockUser } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { resolveUserRefs, userResolver } from '../utils/user-resolver.js'
import { addComments } from './add-comments.js'

vi.mock('../utils/user-resolver.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/user-resolver.js')>()
    return { ...actual, resolveUserRefs: vi.fn() }
})

// Mock the Todoist API
const mockTodoistApi = {
    addComment: vi.fn(),
    getUser: vi.fn(),
    getComments: vi.fn(),
    getTask: vi.fn(),
    getProjectCollaborators: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { ADD_COMMENTS } = ToolNames

function createMockComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: '12345',
        content: 'Test comment content',
        postedAt: new Date('2024-01-01T12:00:00Z'),
        postedUid: 'user123',
        taskId: 'task123',
        projectId: undefined,
        fileAttachment: null,
        uidsToNotify: null,
        reactions: null,
        isDeleted: false,
        ...overrides,
    }
}

const CURRENT_USER_ID = 'current-user'

function createMockTaskWithUids(overrides: Partial<Task> = {}): Task {
    return {
        ...createMockTask(),
        addedByUid: CURRENT_USER_ID,
        assignedByUid: null,
        responsibleUid: null,
        ...overrides,
    }
}

describe(`${ADD_COMMENTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getUser.mockResolvedValue(createMockUser({ id: CURRENT_USER_ID }))
        // Default: an empty thread on an unassigned, self-created task, so
        // nobody is notified unless a test says otherwise.
        mockTodoistApi.getComments.mockResolvedValue({ results: [], nextCursor: null })
        mockTodoistApi.getTask.mockResolvedValue(createMockTaskWithUids())
        mockTodoistApi.getProjectCollaborators.mockResolvedValue({ results: [], nextCursor: null })
        userResolver.clearCache()
    })

    describe('adding comments to tasks', () => {
        it('should add comment to task', async () => {
            const mockComment = createMockComment({
                id: '98765',
                content: 'This is a task comment',
                taskId: 'task456',
            })

            mockTodoistApi.addComment.mockResolvedValue(mockComment)

            const result = await addComments.execute(
                { comments: [{ taskId: 'task456', content: 'This is a task comment' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'This is a task comment',
                taskId: 'task456',
            })

            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: [
                        expect.objectContaining({
                            id: '98765',
                            content: 'This is a task comment',
                            taskId: 'task456',
                        }),
                    ],
                    totalCount: 1,
                    addedCommentIds: ['98765'],
                }),
            )
        })
    })

    describe('adding comments to projects', () => {
        it('should add comment to project', async () => {
            const mockComment = createMockComment({
                id: '98767',
                content: 'This is a project comment',
                taskId: undefined,
                projectId: 'project789',
            })

            mockTodoistApi.addComment.mockResolvedValue(mockComment)

            const result = await addComments.execute(
                { comments: [{ projectId: 'project789', content: 'This is a project comment' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'This is a project comment',
                projectId: 'project789',
            })

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            // Verify structured content
            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: [
                        expect.objectContaining({
                            id: '98767',
                            content: 'This is a project comment',
                            taskId: undefined,
                            projectId: 'project789',
                        }),
                    ],
                    totalCount: 1,
                    addedCommentIds: ['98767'],
                }),
            )
        })
    })

    describe('bulk operations', () => {
        it('should add multiple comments to different entities (task + project)', async () => {
            const mockTaskComment = createMockComment({
                id: '11111',
                content: 'Task comment',
                taskId: 'task123',
                projectId: undefined,
            })

            const mockProjectComment = createMockComment({
                id: '22222',
                content: 'Project comment',
                taskId: undefined,
                projectId: 'project456',
            })

            mockTodoistApi.addComment
                .mockResolvedValueOnce(mockTaskComment)
                .mockResolvedValueOnce(mockProjectComment)

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'task123', content: 'Task comment' },
                        { projectId: 'project456', content: 'Project comment' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'Task comment',
                taskId: 'task123',
            })
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'Project comment',
                projectId: 'project456',
            })

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: [
                        expect.objectContaining({
                            id: '11111',
                            content: 'Task comment',
                            taskId: 'task123',
                        }),
                        expect.objectContaining({
                            id: '22222',
                            content: 'Project comment',
                            projectId: 'project456',
                        }),
                    ],
                    totalCount: 2,
                    addedCommentIds: ['11111', '22222'],
                }),
            )
        })

        it('should add multiple comments to different tasks', async () => {
            const mockComment1 = createMockComment({
                id: '33333',
                content: 'First task comment',
                taskId: 'task111',
            })

            const mockComment2 = createMockComment({
                id: '44444',
                content: 'Second task comment',
                taskId: 'task222',
            })

            mockTodoistApi.addComment
                .mockResolvedValueOnce(mockComment1)
                .mockResolvedValueOnce(mockComment2)

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'task111', content: 'First task comment' },
                        { taskId: 'task222', content: 'Second task comment' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledTimes(2)

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: expect.arrayContaining([
                        expect.objectContaining({
                            id: '33333',
                            content: 'First task comment',
                            taskId: 'task111',
                        }),
                        expect.objectContaining({
                            id: '44444',
                            content: 'Second task comment',
                            taskId: 'task222',
                        }),
                    ]),
                    totalCount: 2,
                    addedCommentIds: ['33333', '44444'],
                }),
            )
        })

        it('should add multiple comments to the same task', async () => {
            const mockComment1 = createMockComment({
                id: '55555',
                content: 'First comment on same task',
                taskId: 'task999',
            })

            const mockComment2 = createMockComment({
                id: '66666',
                content: 'Second comment on same task',
                taskId: 'task999',
            })

            mockTodoistApi.addComment
                .mockResolvedValueOnce(mockComment1)
                .mockResolvedValueOnce(mockComment2)

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'task999', content: 'First comment on same task' },
                        { taskId: 'task999', content: 'Second comment on same task' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'First comment on same task',
                taskId: 'task999',
            })
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'Second comment on same task',
                taskId: 'task999',
            })

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: expect.arrayContaining([
                        expect.objectContaining({
                            id: '55555',
                            content: 'First comment on same task',
                            taskId: 'task999',
                        }),
                        expect.objectContaining({
                            id: '66666',
                            content: 'Second comment on same task',
                            taskId: 'task999',
                        }),
                    ]),
                    totalCount: 2,
                    addedCommentIds: ['55555', '66666'],
                }),
            )
        })
    })

    describe('notifying users', () => {
        const mockResolveUserRefs = vi.mocked(resolveUserRefs)

        function mockAddedComment(uidsToNotify: string[] | null = null) {
            mockTodoistApi.addComment.mockResolvedValue(
                createMockComment({ taskId: 'task456', uidsToNotify }),
            )
        }

        it('should notify explicitly named users, resolving IDs, emails and names alike', async () => {
            mockResolveUserRefs.mockResolvedValue([
                { userId: '111', displayName: 'Ana', email: 'ana@example.com' },
                { userId: '222', displayName: 'Bo', email: 'bo@example.com' },
                { userId: '333', displayName: 'Cleo', email: 'cleo@example.com' },
            ])
            mockAddedComment(['111', '222', '333'])

            const result = await addComments.execute(
                {
                    comments: [
                        {
                            taskId: 'task456',
                            content: 'Please review',
                            notifyUsers: ['111', 'bo@example.com', 'Cleo'],
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockResolveUserRefs).toHaveBeenCalledWith(mockTodoistApi, [
                '111',
                'bo@example.com',
                'Cleo',
            ])
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'Please review',
                taskId: 'task456',
                uidsToNotify: ['111', '222', '333'],
            })
            // Explicit recipients mean the thread never needs reading.
            expect(mockTodoistApi.getComments).not.toHaveBeenCalled()
            expect(result.textContent).toContain('Notified: 111, 222, 333')
        })

        it('should name notified collaborators by short name, falling back to the user ID', async () => {
            mockResolveUserRefs.mockResolvedValue([
                { userId: '111', displayName: '111', email: '111' },
                { userId: '222', displayName: '222', email: '222' },
                { userId: '333', displayName: '333', email: '333' },
            ])
            mockTodoistApi.getProjectCollaborators.mockResolvedValue({
                results: [
                    { id: '111', name: 'Ana Silva', email: 'ana@example.com' },
                    { id: '222', name: 'Bo Berg (OOO Friday)', email: 'bo@example.com' },
                ],
                nextCursor: null,
            })
            mockAddedComment(['111', '222', '333'])

            const result = await addComments.execute(
                {
                    comments: [
                        {
                            taskId: 'task456',
                            content: 'Please review',
                            notifyUsers: ['111', '222', '333'],
                        },
                    ],
                },
                mockTodoistApi,
            )

            // A task comment has no project of its own, so the task is read to find it.
            expect(mockTodoistApi.getTask).toHaveBeenCalledWith('task456')
            expect(mockTodoistApi.getProjectCollaborators).toHaveBeenCalledWith(
                createMockTask().projectId,
                expect.objectContaining({ cursor: null }),
            )
            expect(result.textContent).toContain('Notified: Ana S., Bo B., 333')
        })

        it('should still report a posted comment when its recipients cannot be named', async () => {
            mockResolveUserRefs.mockResolvedValue([
                { userId: '111', displayName: '111', email: '111' },
            ])
            mockTodoistApi.getTask.mockRejectedValue(new Error('Task lookup failed'))
            mockAddedComment(['111'])

            const result = await addComments.execute(
                { comments: [{ taskId: 'task456', content: 'Ping', notifyUsers: ['111'] }] },
                mockTodoistApi,
            )

            expect(result.structuredContent.successCount).toBe(1)
            expect(result.textContent).toContain('Added 1 task comment. Notified: 111')
        })

        it('should report an unresolvable user as a failure without posting', async () => {
            mockResolveUserRefs.mockRejectedValue(
                new Error('Could not find user(s): "Nobody", "Nobody Else".'),
            )

            const result = await addComments.execute(
                {
                    comments: [
                        {
                            taskId: 'task456',
                            content: 'Please review',
                            notifyUsers: ['Nobody', 'Nobody Else'],
                        },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).not.toHaveBeenCalled()
            expect(result.structuredContent.failures).toEqual([
                {
                    item: 'Please review',
                    error: 'Could not find user(s): "Nobody", "Nobody Else".',
                },
            ])
        })

        it('should omit uidsToNotify entirely when told to notify nobody', async () => {
            mockAddedComment()

            await addComments.execute(
                {
                    comments: [{ taskId: 'task456', content: 'Quiet note', notifyUsers: ['none'] }],
                },
                mockTodoistApi,
            )

            // Nobody to notify means no recipient field at all, rather than
            // an empty one.
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'Quiet note',
                taskId: 'task456',
            })
            expect(mockResolveUserRefs).not.toHaveBeenCalled()
            expect(mockTodoistApi.getComments).not.toHaveBeenCalled()
        })

        it('should default a first task comment to the assignee, assigner and creator', async () => {
            mockTodoistApi.getTask.mockResolvedValue(
                createMockTaskWithUids({
                    responsibleUid: 'assignee',
                    assignedByUid: 'assigner',
                    addedByUid: 'creator',
                }),
            )
            mockAddedComment(['assignee', 'assigner', 'creator'])

            await addComments.execute(
                { comments: [{ taskId: 'task456', content: 'First comment' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'First comment',
                taskId: 'task456',
                uidsToNotify: ['assignee', 'assigner', 'creator'],
            })
        })

        it('should read a task once to find both its default recipients and their names', async () => {
            mockTodoistApi.getTask.mockResolvedValue(
                createMockTaskWithUids({ responsibleUid: 'assignee' }),
            )
            mockTodoistApi.getProjectCollaborators.mockResolvedValue({
                results: [{ id: 'assignee', name: 'Ada Lovelace', email: 'ada@example.com' }],
                nextCursor: null,
            })
            mockAddedComment(['assignee'])

            const result = await addComments.execute(
                { comments: [{ taskId: 'task456', content: 'First comment' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getTask).toHaveBeenCalledTimes(1)
            // The current user was already fetched, so it is not fetched again to name people.
            expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(1)
            expect(result.textContent).toContain('Notified: Ada L.')
        })

        it('should name the recipients of a project comment without reading any task', async () => {
            mockResolveUserRefs.mockResolvedValue([
                { userId: '111', displayName: '111', email: '111' },
            ])
            mockTodoistApi.addComment.mockResolvedValue(
                createMockComment({
                    taskId: undefined,
                    projectId: 'project789',
                    uidsToNotify: ['111'],
                }),
            )
            mockTodoistApi.getProjectCollaborators.mockResolvedValue({
                results: [{ id: '111', name: 'Ana Silva', email: 'ana@example.com' }],
                nextCursor: null,
            })

            const result = await addComments.execute(
                { comments: [{ projectId: 'project789', content: 'Ping', notifyUsers: ['111'] }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getTask).not.toHaveBeenCalled()
            expect(mockTodoistApi.getProjectCollaborators).toHaveBeenCalledWith(
                'project789',
                expect.objectContaining({ cursor: null }),
            )
            expect(result.textContent).toContain('Notified: Ana S.')
        })

        it('should still name the other comments when one task cannot be read', async () => {
            mockResolveUserRefs.mockImplementation(async (_client, refs) =>
                refs.map((ref) => ({ userId: ref, displayName: ref, email: ref })),
            )
            mockTodoistApi.getTask.mockRejectedValue(new Error('Task lookup failed'))
            mockTodoistApi.addComment
                .mockResolvedValueOnce(createMockComment({ taskId: 'gone', uidsToNotify: ['111'] }))
                .mockResolvedValueOnce(
                    createMockComment({
                        id: '67890',
                        taskId: undefined,
                        projectId: 'project789',
                        uidsToNotify: ['222'],
                    }),
                )
            mockTodoistApi.getProjectCollaborators.mockResolvedValue({
                results: [{ id: '222', name: 'Bo Berg', email: 'bo@example.com' }],
                nextCursor: null,
            })

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'gone', content: 'First', notifyUsers: ['111'] },
                        { projectId: 'project789', content: 'Second', notifyUsers: ['222'] },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent.successCount).toBe(2)
            expect(result.textContent).toContain('Notified: 111, Bo B.')
        })

        it('should exclude the comment author and drop unset uids from the defaults', async () => {
            mockTodoistApi.getTask.mockResolvedValue(
                createMockTaskWithUids({
                    responsibleUid: CURRENT_USER_ID,
                    assignedByUid: null,
                    addedByUid: 'creator',
                }),
            )
            mockAddedComment(['creator'])

            await addComments.execute(
                { comments: [{ taskId: 'task456', content: 'First comment' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledWith(
                expect.objectContaining({ uidsToNotify: ['creator'] }),
            )
        })

        it("should default a reply to the previous comment's participants", async () => {
            mockTodoistApi.getComments.mockResolvedValue({
                results: [
                    createMockComment({
                        id: 'older',
                        postedAt: new Date('2024-01-01T09:00:00Z'),
                        postedUid: 'stale-author',
                        uidsToNotify: ['stale-recipient'],
                    }),
                    createMockComment({
                        id: 'newest',
                        postedAt: new Date('2024-01-01T15:00:00Z'),
                        postedUid: 'previous-author',
                        uidsToNotify: ['participant', CURRENT_USER_ID],
                    }),
                ],
                nextCursor: null,
            })
            mockTodoistApi.getTask.mockResolvedValue(
                createMockTaskWithUids({ responsibleUid: 'task-assignee' }),
            )
            mockAddedComment(['participant', 'previous-author'])

            await addComments.execute(
                { comments: [{ taskId: 'task456', content: 'Reply' }] },
                mockTodoistApi,
            )

            // A thread that already has comments settles the recipients, so the
            // task's own assignee is not added to them.
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'Reply',
                taskId: 'task456',
                uidsToNotify: ['participant', 'previous-author'],
            })
        })

        it('should notify nobody on a first project comment', async () => {
            mockTodoistApi.addComment.mockResolvedValue(
                createMockComment({ taskId: undefined, projectId: 'project789' }),
            )

            await addComments.execute(
                { comments: [{ projectId: 'project789', content: 'Project note' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledWith({
                content: 'Project note',
                projectId: 'project789',
            })
            expect(mockTodoistApi.getTask).not.toHaveBeenCalled()
        })

        it('should read a shared thread once for several comments on the same task', async () => {
            mockTodoistApi.getTask.mockResolvedValue(
                createMockTaskWithUids({ responsibleUid: 'assignee' }),
            )
            mockAddedComment(['assignee'])

            await addComments.execute(
                {
                    comments: [
                        { taskId: 'task456', content: 'First' },
                        { taskId: 'task456', content: 'Second' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.getComments).toHaveBeenCalledTimes(1)
            expect(mockTodoistApi.addComment).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.addComment).toHaveBeenCalledWith(
                expect.objectContaining({ content: 'Second', uidsToNotify: ['assignee'] }),
            )
        })

        it('should surface who was notified, and omit the field when nobody was', async () => {
            mockAddedComment(['111', '222'])
            const notified = await addComments.execute(
                {
                    comments: [{ taskId: 'task456', content: 'Heads up', notifyUsers: ['none'] }],
                },
                mockTodoistApi,
            )
            expect(notified.structuredContent?.comments[0]).toEqual(
                expect.objectContaining({ notifiedUserIds: ['111', '222'] }),
            )

            mockAddedComment()
            const silent = await addComments.execute(
                {
                    comments: [{ taskId: 'task456', content: 'Quiet note', notifyUsers: ['none'] }],
                },
                mockTodoistApi,
            )
            expect(silent.structuredContent?.comments[0]?.notifiedUserIds).toBeUndefined()
        })
    })

    describe('notifyUsers schema bounds', () => {
        const parse = (notifyUsers: unknown) =>
            z.object(addComments.parameters).safeParse({
                comments: [{ taskId: 'task456', content: 'x', notifyUsers }],
            })

        it('rejects an empty list, so ["none"] stays the only way to stay silent', () => {
            expect(parse([]).success).toBe(false)
        })

        it('rejects more recipients than a single comment may notify', () => {
            const tooMany = Array.from(
                { length: ApiLimits.NOTIFY_USERS_MAX + 1 },
                (_, i) => `u${i}`,
            )

            expect(parse(tooMany).success).toBe(false)
            expect(parse(tooMany.slice(0, ApiLimits.NOTIFY_USERS_MAX)).success).toBe(true)
        })
    })

    describe('validation', () => {
        it('should report a comment with neither taskId nor projectId as a failure', async () => {
            const result = await addComments.execute(
                { comments: [{ content: 'Test comment' }] },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).not.toHaveBeenCalled()
            expect(result.structuredContent.failures).toEqual([
                { item: 'Test comment', error: 'Either taskId or projectId must be provided.' },
            ])
        })

        it('should report a comment with both taskId and projectId as a failure', async () => {
            const comment = { taskId: 'task123', projectId: 'project456', content: 'Test comment' }
            const result = await addComments.execute({ comments: [comment] }, mockTodoistApi)

            expect(mockTodoistApi.addComment).not.toHaveBeenCalled()
            expect(result.structuredContent.failures).toEqual([
                {
                    item: 'Test comment',
                    error: 'Cannot provide both taskId and projectId. Choose one.',
                },
            ])
        })
    })

    describe('partial failures', () => {
        it('reports the posted comment alongside the failed one, so a retry can skip it', async () => {
            // https://github.com/Doist/todoist-mcp/issues/505: the first comment is saved and
            // the second targets an invalid task. Reporting only an error led callers to
            // replay the batch and post the first comment twice.
            const invalidTaskId = Object.assign(new Error('HTTP 400: Bad Request'), {
                httpStatusCode: 400,
                responseData: {
                    error: 'Invalid argument value',
                    error_code: 20,
                    error_extra: { argument: 'task_id' },
                    error_tag: 'INVALID_ARGUMENT_VALUE',
                    http_code: 400,
                },
            })
            mockTodoistApi.addComment
                .mockResolvedValueOnce(
                    createMockComment({
                        id: 'posted',
                        taskId: 'task123',
                        content: 'Valid comment',
                    }),
                )
                .mockRejectedValueOnce(invalidTaskId)

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'task123', content: 'Valid comment', notifyUsers: ['none'] },
                        {
                            taskId: '0000000000000000',
                            content: 'Invalid destination',
                            notifyUsers: ['none'],
                        },
                    ],
                },
                mockTodoistApi,
            )

            const { structuredContent } = result
            expect(structuredContent.addedCommentIds).toEqual(['posted'])
            expect(structuredContent.totalRequested).toBe(2)
            expect(structuredContent.successCount).toBe(1)
            expect(structuredContent.failureCount).toBe(1)
            expect(structuredContent.failures).toEqual([
                {
                    item: 'Invalid destination',
                    error: 'Invalid argument value (HTTP 400, code 20, tag INVALID_ARGUMENT_VALUE)',
                },
            ])
            expect(result.textContent).toContain('Added 1 task comment')
            expect(result.textContent).toContain('Failed (1) - address or drop these items')
        })

        it('returns structured failures when every comment in the batch fails', async () => {
            mockTodoistApi.addComment.mockRejectedValue(new Error('API Error: Task not found'))

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'missing-1', content: 'First', notifyUsers: ['none'] },
                        { taskId: 'missing-2', content: 'Second', notifyUsers: ['none'] },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent.comments).toEqual([])
            expect(result.structuredContent.failures.map((failure) => failure.item)).toEqual([
                'First',
                'Second',
            ])
            expect(result.textContent).toContain('No comments added')
        })

        it('fails only the comments that need the current user when it cannot be fetched', async () => {
            mockTodoistApi.getUser.mockRejectedValueOnce(new Error('API Error: Unauthorized'))
            mockTodoistApi.addComment.mockResolvedValue(
                createMockComment({ id: 'silent', taskId: 'task123' }),
            )

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'task123', content: 'Silent note', notifyUsers: ['none'] },
                        { projectId: 'inbox', content: 'Inbox note', notifyUsers: ['none'] },
                    ],
                },
                mockTodoistApi,
            )

            expect(result.structuredContent.addedCommentIds).toEqual(['silent'])
            expect(result.structuredContent.failures).toEqual([
                { item: 'Inbox note', error: 'API Error: Unauthorized' },
            ])
        })

        it('does not retry a comment that failed with a 502, since it may have been posted', async () => {
            mockTodoistApi.addComment.mockRejectedValueOnce(
                Object.assign(new Error('Bad Gateway'), { httpStatusCode: 502 }),
            )

            const result = await addComments.execute(
                {
                    comments: [
                        { taskId: 'task123', content: 'Maybe posted', notifyUsers: ['none'] },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.addComment).toHaveBeenCalledOnce()
            expect(result.structuredContent.failures).toEqual([
                { item: 'Maybe posted', error: 'Bad Gateway (HTTP 502)' },
            ])
        })

        it('retries a transient 5xx failure on a per-comment call', async () => {
            vi.useFakeTimers()
            try {
                mockTodoistApi.addComment
                    .mockRejectedValueOnce(
                        Object.assign(new Error('Service Unavailable'), { httpStatusCode: 503 }),
                    )
                    .mockResolvedValueOnce(createMockComment({ id: 'retried' }))

                const promise = addComments.execute(
                    {
                        comments: [
                            { taskId: 'task123', content: 'Retry me', notifyUsers: ['none'] },
                        ],
                    },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                const result = await promise

                expect(mockTodoistApi.addComment).toHaveBeenCalledTimes(2)
                expect(result.structuredContent.addedCommentIds).toEqual(['retried'])
            } finally {
                vi.useRealTimers()
            }
        })
    })
})
