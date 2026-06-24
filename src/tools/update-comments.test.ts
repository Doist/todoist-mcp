import type { Comment, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { ToolNames } from '../utils/tool-names.js'
import { updateComments } from './update-comments.js'

// Mock the Todoist API
const mockTodoistApi = {
    updateComment: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { UPDATE_COMMENTS } = ToolNames

const createMockComment = (overrides: Partial<Comment> = {}): Comment => ({
    id: '12345',
    content: 'Updated comment content',
    postedAt: new Date('2024-01-01T12:00:00Z'),
    postedUid: 'user123',
    taskId: 'task123',
    projectId: undefined,
    fileAttachment: null,
    uidsToNotify: null,
    reactions: null,
    isDeleted: false,
    ...overrides,
})

describe(`${UPDATE_COMMENTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should update comment content', async () => {
        const mockComment = createMockComment({
            id: '98765',
            content: 'Updated content here',
            taskId: 'task456',
        })

        mockTodoistApi.updateComment.mockResolvedValue(mockComment)

        const result = await updateComments.execute(
            {
                comments: [
                    {
                        id: '98765',
                        content: 'Updated content here',
                    },
                ],
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.updateComment).toHaveBeenCalledWith('98765', {
            content: 'Updated content here',
        })

        // Verify result is a concise summary
        expect(result.textContent).toMatchSnapshot()

        // Verify structured content
        const structuredContent = result.structuredContent
        expect(structuredContent).toEqual(
            expect.objectContaining({
                comments: [
                    expect.objectContaining({
                        id: '98765',
                        content: 'Updated content here',
                        taskId: 'task456',
                    }),
                ],
                totalCount: 1,
                updatedCommentIds: ['98765'],
                appliedOperations: {
                    updateCount: 1,
                },
            }),
        )
    })

    it('should handle project comment', async () => {
        const mockComment = createMockComment({
            id: '98767',
            content: 'Updated project comment',
            taskId: undefined,
            projectId: 'project789',
        })

        mockTodoistApi.updateComment.mockResolvedValue(mockComment)

        const result = await updateComments.execute(
            {
                comments: [
                    {
                        id: '98767',
                        content: 'Updated project comment',
                    },
                ],
            },
            mockTodoistApi,
        )

        // Verify result is a concise summary
        expect(result.textContent).toMatchSnapshot()

        // Verify structured content
        const structuredContent = result.structuredContent
        expect(structuredContent).toEqual(
            expect.objectContaining({
                comments: [
                    expect.objectContaining({
                        id: '98767',
                        content: 'Updated project comment',
                        taskId: undefined,
                        projectId: 'project789',
                    }),
                ],
                totalCount: 1,
                updatedCommentIds: ['98767'],
                appliedOperations: {
                    updateCount: 1,
                },
            }),
        )
    })

    describe('bulk operations', () => {
        it('should update multiple comments from different entities (task + project)', async () => {
            const mockTaskComment = createMockComment({
                id: '11111',
                content: 'Updated task comment',
                taskId: 'task123',
                projectId: undefined,
            })

            const mockProjectComment = createMockComment({
                id: '22222',
                content: 'Updated project comment',
                taskId: undefined,
                projectId: 'project456',
            })

            mockTodoistApi.updateComment
                .mockResolvedValueOnce(mockTaskComment)
                .mockResolvedValueOnce(mockProjectComment)

            const result = await updateComments.execute(
                {
                    comments: [
                        { id: '11111', content: 'Updated task comment' },
                        { id: '22222', content: 'Updated project comment' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateComment).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.updateComment).toHaveBeenCalledWith('11111', {
                content: 'Updated task comment',
            })
            expect(mockTodoistApi.updateComment).toHaveBeenCalledWith('22222', {
                content: 'Updated project comment',
            })

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: [
                        expect.objectContaining({
                            id: '11111',
                            content: 'Updated task comment',
                            taskId: 'task123',
                        }),
                        expect.objectContaining({
                            id: '22222',
                            content: 'Updated project comment',
                            projectId: 'project456',
                        }),
                    ],
                    totalCount: 2,
                    updatedCommentIds: ['11111', '22222'],
                    appliedOperations: {
                        updateCount: 2,
                    },
                }),
            )
        })

        it('should update multiple comments from different tasks', async () => {
            const mockComment1 = createMockComment({
                id: '33333',
                content: 'Updated first task comment',
                taskId: 'task111',
            })

            const mockComment2 = createMockComment({
                id: '44444',
                content: 'Updated second task comment',
                taskId: 'task222',
            })

            mockTodoistApi.updateComment
                .mockResolvedValueOnce(mockComment1)
                .mockResolvedValueOnce(mockComment2)

            const result = await updateComments.execute(
                {
                    comments: [
                        { id: '33333', content: 'Updated first task comment' },
                        { id: '44444', content: 'Updated second task comment' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateComment).toHaveBeenCalledTimes(2)

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: expect.arrayContaining([
                        expect.objectContaining({
                            id: '33333',
                            content: 'Updated first task comment',
                            taskId: 'task111',
                        }),
                        expect.objectContaining({
                            id: '44444',
                            content: 'Updated second task comment',
                            taskId: 'task222',
                        }),
                    ]),
                    totalCount: 2,
                    updatedCommentIds: ['33333', '44444'],
                    appliedOperations: {
                        updateCount: 2,
                    },
                }),
            )
        })

        it('should update multiple comments from the same task', async () => {
            const mockComment1 = createMockComment({
                id: '55555',
                content: 'Updated first comment on same task',
                taskId: 'task999',
            })

            const mockComment2 = createMockComment({
                id: '66666',
                content: 'Updated second comment on same task',
                taskId: 'task999',
            })

            mockTodoistApi.updateComment
                .mockResolvedValueOnce(mockComment1)
                .mockResolvedValueOnce(mockComment2)

            const result = await updateComments.execute(
                {
                    comments: [
                        { id: '55555', content: 'Updated first comment on same task' },
                        { id: '66666', content: 'Updated second comment on same task' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateComment).toHaveBeenCalledTimes(2)
            expect(mockTodoistApi.updateComment).toHaveBeenCalledWith('55555', {
                content: 'Updated first comment on same task',
            })
            expect(mockTodoistApi.updateComment).toHaveBeenCalledWith('66666', {
                content: 'Updated second comment on same task',
            })

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: expect.arrayContaining([
                        expect.objectContaining({
                            id: '55555',
                            content: 'Updated first comment on same task',
                            taskId: 'task999',
                        }),
                        expect.objectContaining({
                            id: '66666',
                            content: 'Updated second comment on same task',
                            taskId: 'task999',
                        }),
                    ]),
                    totalCount: 2,
                    updatedCommentIds: ['55555', '66666'],
                    appliedOperations: {
                        updateCount: 2,
                    },
                }),
            )
        })

        it('should update multiple comments from the same project', async () => {
            const mockComment1 = createMockComment({
                id: '77777',
                content: 'Updated first project comment',
                taskId: undefined,
                projectId: 'project888',
            })

            const mockComment2 = createMockComment({
                id: '88888',
                content: 'Updated second project comment',
                taskId: undefined,
                projectId: 'project888',
            })

            mockTodoistApi.updateComment
                .mockResolvedValueOnce(mockComment1)
                .mockResolvedValueOnce(mockComment2)

            const result = await updateComments.execute(
                {
                    comments: [
                        { id: '77777', content: 'Updated first project comment' },
                        { id: '88888', content: 'Updated second project comment' },
                    ],
                },
                mockTodoistApi,
            )

            expect(mockTodoistApi.updateComment).toHaveBeenCalledTimes(2)

            // Verify result is a concise summary
            expect(result.textContent).toMatchSnapshot()

            const structuredContent = result.structuredContent
            expect(structuredContent).toEqual(
                expect.objectContaining({
                    comments: expect.arrayContaining([
                        expect.objectContaining({
                            id: '77777',
                            content: 'Updated first project comment',
                            projectId: 'project888',
                        }),
                        expect.objectContaining({
                            id: '88888',
                            content: 'Updated second project comment',
                            projectId: 'project888',
                        }),
                    ]),
                    totalCount: 2,
                    updatedCommentIds: ['77777', '88888'],
                    appliedOperations: {
                        updateCount: 2,
                    },
                }),
            )
        })
    })
})
