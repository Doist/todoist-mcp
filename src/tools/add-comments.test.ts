import type { Comment, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockUser } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { addComments } from './add-comments.js'

// Mock the Todoist API
const mockTodoistApi = {
    addComment: vi.fn(),
    getUser: vi.fn(),
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

describe(`${ADD_COMMENTS} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getUser.mockResolvedValue(createMockUser())
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

    describe('validation', () => {
        it('should throw error when neither taskId nor projectId provided', async () => {
            await expect(
                addComments.execute({ comments: [{ content: 'Test comment' }] }, mockTodoistApi),
            ).rejects.toThrow('Comment 1: Either taskId or projectId must be provided.')
        })

        it('should throw error when both taskId and projectId provided', async () => {
            const comment = { taskId: 'task123', projectId: 'project456', content: 'Test comment' }
            await expect(
                addComments.execute({ comments: [comment] }, mockTodoistApi),
            ).rejects.toThrow('Comment 1: Cannot provide both taskId and projectId. Choose one.')
        })
    })
})
