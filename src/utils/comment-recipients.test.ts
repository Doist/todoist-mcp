import type { Comment, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import {
    NO_NOTIFY_KEYWORD,
    getDefaultCommentRecipients,
    isNoNotifyList,
} from './comment-recipients.js'
import { createMockTask } from './test-helpers.js'

const CURRENT_USER_ID = 'current-user'

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: 'comment-1',
        content: 'Existing comment',
        postedAt: new Date('2024-01-01T12:00:00Z'),
        postedUid: 'previous-author',
        taskId: 'task-1',
        projectId: undefined,
        fileAttachment: null,
        uidsToNotify: null,
        reactions: null,
        isDeleted: false,
        ...overrides,
    }
}

describe('isNoNotifyList', () => {
    it.each([[NO_NOTIFY_KEYWORD], ['None'], ['  NONE  ']])('treats %j as the opt-out', (value) => {
        expect(isNoNotifyList([value])).toBe(true)
    })

    it.each([[[]], [['none', 'Ana']], [['nobody']]])('treats %j as a real list', (value) => {
        expect(isNoNotifyList(value)).toBe(false)
    })
})

describe('getDefaultCommentRecipients', () => {
    let mockClient: Mocked<TodoistApi>

    beforeEach(() => {
        mockClient = {
            getComments: vi.fn().mockResolvedValue({ results: [], nextCursor: null }),
            getTask: vi.fn().mockResolvedValue(createMockTask()),
        } as unknown as Mocked<TodoistApi>
    })

    describe('a thread that already has comments', () => {
        it("takes the newest comment's participants, not the first page's", async () => {
            mockClient.getComments.mockResolvedValue({
                results: [
                    createComment({
                        id: 'newest',
                        postedAt: new Date('2024-03-01T09:00:00Z'),
                        postedUid: 'recent-author',
                        uidsToNotify: ['recent-participant'],
                    }),
                    createComment({
                        id: 'oldest',
                        postedAt: new Date('2024-01-01T09:00:00Z'),
                        postedUid: 'stale-author',
                        uidsToNotify: ['stale-participant'],
                    }),
                ],
                nextCursor: null,
            })

            const recipients = await getDefaultCommentRecipients(
                mockClient,
                { taskId: 'task-1' },
                CURRENT_USER_ID,
            )

            expect(recipients).toEqual(['recent-participant', 'recent-author'])
            expect(mockClient.getTask).not.toHaveBeenCalled()
        })

        it('keeps the chain alive from a comment that notified nobody', async () => {
            mockClient.getComments.mockResolvedValue({
                results: [createComment({ postedUid: 'agent', uidsToNotify: null })],
                nextCursor: null,
            })

            const recipients = await getDefaultCommentRecipients(
                mockClient,
                { taskId: 'task-1' },
                CURRENT_USER_ID,
            )

            expect(recipients).toEqual(['agent'])
        })

        it('excludes the author of the comment being posted', async () => {
            mockClient.getComments.mockResolvedValue({
                results: [
                    createComment({
                        postedUid: CURRENT_USER_ID,
                        uidsToNotify: [CURRENT_USER_ID, 'other'],
                    }),
                ],
                nextCursor: null,
            })

            const recipients = await getDefaultCommentRecipients(
                mockClient,
                { taskId: 'task-1' },
                CURRENT_USER_ID,
            )

            expect(recipients).toEqual(['other'])
        })
    })

    describe('a task with no comments yet', () => {
        it('takes the assignee, assigner and creator', async () => {
            mockClient.getTask.mockResolvedValue(
                createMockTask({
                    responsibleUid: 'assignee',
                    assignedByUid: 'assigner',
                    addedByUid: 'creator',
                }),
            )

            const recipients = await getDefaultCommentRecipients(
                mockClient,
                { taskId: 'task-1' },
                CURRENT_USER_ID,
            )

            expect(recipients).toEqual(['assignee', 'assigner', 'creator'])
        })

        it('drops unset uids and collapses a person filling two roles', async () => {
            mockClient.getTask.mockResolvedValue(
                createMockTask({
                    responsibleUid: 'ana',
                    assignedByUid: null,
                    addedByUid: 'ana',
                }),
            )

            const recipients = await getDefaultCommentRecipients(
                mockClient,
                { taskId: 'task-1' },
                CURRENT_USER_ID,
            )

            expect(recipients).toEqual(['ana'])
        })

        it('notifies nobody when the author is the only party', async () => {
            mockClient.getTask.mockResolvedValue(
                createMockTask({
                    responsibleUid: CURRENT_USER_ID,
                    assignedByUid: null,
                    addedByUid: CURRENT_USER_ID,
                }),
            )

            const recipients = await getDefaultCommentRecipients(
                mockClient,
                { taskId: 'task-1' },
                CURRENT_USER_ID,
            )

            expect(recipients).toEqual([])
        })
    })

    it('walks every page of a long thread to reach the newest comment', async () => {
        mockClient.getComments
            .mockResolvedValueOnce({
                results: [
                    createComment({ postedAt: new Date('2024-01-01T09:00:00Z'), postedUid: 'p1' }),
                ],
                nextCursor: 'page-2',
            })
            .mockResolvedValueOnce({
                results: [
                    createComment({ postedAt: new Date('2024-02-01T09:00:00Z'), postedUid: 'p2' }),
                ],
                nextCursor: 'page-3',
            })
            .mockResolvedValueOnce({
                results: [
                    createComment({ postedAt: new Date('2024-03-01T09:00:00Z'), postedUid: 'p3' }),
                ],
                nextCursor: null,
            })

        const recipients = await getDefaultCommentRecipients(
            mockClient,
            { taskId: 'task-1' },
            CURRENT_USER_ID,
        )

        expect(mockClient.getComments).toHaveBeenCalledTimes(3)
        expect(mockClient.getComments).toHaveBeenLastCalledWith(
            expect.objectContaining({ cursor: 'page-3' }),
        )
        expect(recipients).toEqual(['p3'])
    })

    describe('a project with no comments yet', () => {
        it('notifies nobody, as a project has no assignee to fall back on', async () => {
            const recipients = await getDefaultCommentRecipients(
                mockClient,
                { projectId: 'project-1' },
                CURRENT_USER_ID,
            )

            expect(mockClient.getComments).toHaveBeenCalledWith(
                expect.objectContaining({ projectId: 'project-1' }),
            )
            expect(recipients).toEqual([])
            expect(mockClient.getTask).not.toHaveBeenCalled()
        })
    })
})
