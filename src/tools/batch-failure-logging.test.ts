import type { TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import {
    createMockProject,
    createMockTask,
    createMockUser,
    TEST_IDS,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { addProjects } from './add-projects.js'
import { addSections } from './add-sections.js'
import { addTasks } from './add-tasks.js'
import { completeTasks } from './complete-tasks.js'
import { uncompleteTasks } from './uncomplete-tasks.js'
import { updateProjects } from './update-projects.js'
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
        // `add-tasks` throws when every task fails, so only a partial failure
        // reaches the log.
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
            getProject: vi.fn().mockResolvedValue(createMockProject()),
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
