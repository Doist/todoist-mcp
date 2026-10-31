import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import {
    createMockProject,
    createMockTask,
    createMockUser,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { addComments } from './add-comments.js'
import { addFilters } from './add-filters.js'
import { addLabels } from './add-labels.js'
import { addProjects } from './add-projects.js'
import { addReminders } from './add-reminders.js'
import { addSections } from './add-sections.js'
import { addTasks } from './add-tasks.js'
import { completeTasks } from './complete-tasks.js'
import { uncompleteTasks } from './uncomplete-tasks.js'
import { updateComments } from './update-comments.js'
import { updateFilters } from './update-filters.js'
import { updateLabels } from './update-labels.js'
import { updateProjects } from './update-projects.js'
import { updateReminders } from './update-reminders.js'
import { updateSections } from './update-sections.js'
import { updateTasks } from './update-tasks.js'

/**
 * Every batch tool reports per-item failures in its result rather than throwing,
 * so a lost `logBatchFailures` call is invisible: the tool keeps working and the
 * failures simply stop reaching the logs. One case per call site keeps that
 * wiring covered.
 */
const apiError = new Error('HTTP 403: Forbidden')

const cases = [
    {
        toolName: ToolNames.COMPLETE_TASKS,
        of: 1,
        item: TEST_IDS.TASK_1,
        run: (client: Mocked<TodoistApi>) => {
            client.closeTask.mockRejectedValue(apiError)
            return completeTasks.execute({ ids: [TEST_IDS.TASK_1] }, client)
        },
    },
    {
        toolName: ToolNames.UNCOMPLETE_TASKS,
        of: 1,
        item: TEST_IDS.TASK_1,
        run: (client: Mocked<TodoistApi>) => {
            client.reopenTask.mockRejectedValue(apiError)
            return uncompleteTasks.execute({ ids: [TEST_IDS.TASK_1] }, client)
        },
    },
    {
        toolName: ToolNames.UPDATE_TASKS,
        of: 1,
        item: TEST_IDS.TASK_1,
        run: (client: Mocked<TodoistApi>) => {
            client.updateTask.mockRejectedValue(apiError)
            return updateTasks.execute(
                { tasks: [{ id: TEST_IDS.TASK_1, content: 'Updated content' }] },
                client,
            )
        },
    },
    {
        toolName: ToolNames.UPDATE_PROJECTS,
        of: 1,
        item: TEST_IDS.PROJECT_TEST,
        run: (client: Mocked<TodoistApi>) => {
            client.updateProject.mockRejectedValue(apiError)
            return updateProjects.execute(
                { projects: [{ id: TEST_IDS.PROJECT_TEST, name: 'Renamed' }] },
                client,
            )
        },
    },
    {
        // The `add-*` tools label a failure with the caller's own text, which
        // must not reach the logs.
        toolName: ToolNames.ADD_PROJECTS,
        of: 1,
        item: '[redacted]',
        run: (client: Mocked<TodoistApi>) => {
            client.addProject.mockRejectedValue(apiError)
            return addProjects.execute({ projects: [{ name: 'A project' }] }, client)
        },
    },
    {
        toolName: ToolNames.ADD_SECTIONS,
        of: 1,
        item: '[redacted]',
        run: (client: Mocked<TodoistApi>) => {
            client.addSection.mockRejectedValue(apiError)
            return addSections.execute(
                { sections: [{ name: 'A section', projectId: TEST_IDS.PROJECT_TEST }] },
                client,
            )
        },
    },
    {
        toolName: ToolNames.ADD_TASKS,
        of: 2,
        item: '[redacted]',
        run: (client: Mocked<TodoistApi>) => {
            client.addTask
                .mockResolvedValueOnce(createMockTask({ content: 'First task' }))
                .mockRejectedValueOnce(apiError)
            return addTasks.execute(
                {
                    tasks: [
                        { content: 'First task', projectId: TEST_IDS.PROJECT_TEST },
                        { content: 'Second task', projectId: TEST_IDS.PROJECT_TEST },
                    ],
                },
                client,
            )
        },
    },
    {
        toolName: ToolNames.ADD_COMMENTS,
        of: 1,
        item: '[redacted]',
        run: (client: Mocked<TodoistApi>) => {
            client.addComment.mockRejectedValue(apiError)
            return addComments.execute(
                {
                    comments: [
                        { taskId: TEST_IDS.TASK_1, content: 'A comment', notifyUsers: ['none'] },
                    ],
                },
                client,
            )
        },
    },
    {
        toolName: ToolNames.UPDATE_COMMENTS,
        of: 1,
        item: 'comment-1',
        run: (client: Mocked<TodoistApi>) => {
            client.updateComment.mockRejectedValue(apiError)
            return updateComments.execute(
                { comments: [{ id: 'comment-1', content: 'Edited' }] },
                client,
            )
        },
    },
    {
        toolName: ToolNames.ADD_LABELS,
        of: 1,
        item: '[redacted]',
        run: (client: Mocked<TodoistApi>) => {
            client.addLabel.mockRejectedValue(apiError)
            return addLabels.execute({ labels: [{ name: 'A label' }] }, client)
        },
    },
    {
        // A shared label is identified by its name, which is the caller's own text.
        toolName: ToolNames.UPDATE_LABELS,
        of: 1,
        item: '[redacted]',
        run: (client: Mocked<TodoistApi>) => {
            client.renameSharedLabel.mockRejectedValue(apiError)
            return updateLabels.execute(
                { labels: [{ labelType: 'shared', name: 'team', newName: 'squad' }] },
                client,
            )
        },
    },
    {
        toolName: ToolNames.UPDATE_SECTIONS,
        of: 1,
        item: 'section-1',
        run: (client: Mocked<TodoistApi>) => {
            client.updateSection.mockRejectedValue(apiError)
            return updateSections.execute(
                { sections: [{ id: 'section-1', name: 'Renamed' }] },
                client,
            )
        },
    },
    {
        toolName: ToolNames.ADD_REMINDERS,
        of: 1,
        item: `Reminder 1 on task ${TEST_IDS.TASK_1}`,
        run: (client: Mocked<TodoistApi>) => {
            client.addReminder.mockRejectedValue(apiError)
            return addReminders.execute(
                { reminders: [{ type: 'relative', taskId: TEST_IDS.TASK_1, minuteOffset: 15 }] },
                client,
            )
        },
    },
    {
        toolName: ToolNames.UPDATE_REMINDERS,
        of: 1,
        item: 'reminder-1',
        run: (client: Mocked<TodoistApi>) => {
            client.updateReminder.mockRejectedValue(apiError)
            return updateReminders.execute(
                { reminders: [{ type: 'relative', id: 'reminder-1', minuteOffset: 30 }] },
                client,
            )
        },
    },
    {
        toolName: ToolNames.ADD_FILTERS,
        of: 1,
        item: '[redacted]',
        run: (client: Mocked<TodoistApi>) => {
            client.sync.mockRejectedValue(apiError)
            return addFilters.execute({ filters: [{ name: 'A filter', query: 'today' }] }, client)
        },
    },
    {
        toolName: ToolNames.UPDATE_FILTERS,
        of: 1,
        item: 'filter-1',
        run: (client: Mocked<TodoistApi>) => {
            client.sync.mockRejectedValue(apiError)
            return updateFilters.execute({ filters: [{ id: 'filter-1', name: 'Renamed' }] }, client)
        },
    },
]

describe('batch tools log the items they could not act on', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>
    let mockTodoistApi: Mocked<TodoistApi>

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockTodoistApi = {
            closeTask: vi.fn(),
            reopenTask: vi.fn(),
            updateTask: vi.fn(),
            moveTask: vi.fn(),
            moveTasks: vi.fn(),
            getTasks: vi.fn(),
            addTask: vi.fn(),
            addProject: vi.fn(),
            updateProject: vi.fn(),
            addSection: vi.fn(),
            addComment: vi.fn(),
            updateComment: vi.fn(),
            addLabel: vi.fn(),
            renameSharedLabel: vi.fn(),
            updateSection: vi.fn(),
            addReminder: vi.fn(),
            updateReminder: vi.fn(),
            sync: vi.fn(),
            getProject: vi.fn().mockResolvedValue(createMockProject()),
            getPersonalProjectCapacity: vi
                .fn()
                .mockResolvedValue({ maxProjects: 5, activeCount: 0, remaining: 5 }),
            getWorkspaces: vi.fn().mockResolvedValue([]),
            getUser: vi.fn().mockResolvedValue(createMockUser()),
        } as unknown as Mocked<TodoistApi>
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
    })

    it.each(cases)('$toolName', async ({ toolName, of, item, run }) => {
        await run(mockTodoistApi)

        expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith(`${toolName}: items failed`, {
            failed: 1,
            of,
            sample: [expect.objectContaining({ item, error: expect.any(String) })],
        })
    })
})
