import {
    createCommand,
    type SyncError,
    type TodoistApi,
    TodoistRequestError,
    TodoistSyncError,
} from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { settleSyncCommands } from './sync-commands.js'

const mockTodoistApi = {
    sync: vi.fn(),
} as unknown as Mocked<TodoistApi>

const COMMAND_ERROR: SyncError = {
    error: 'Invalid argument value',
    errorCode: 20,
    errorExtra: { argument: 'query' },
    errorTag: 'INVALID_ARGUMENT_VALUE',
    httpCode: 400,
}

function createCommands() {
    return [
        createCommand('filter_add', { name: 'A', query: 'today' }, 'tempA'),
        createCommand('filter_add', { name: 'B', query: '((' }, 'tempB'),
    ]
}

describe('settleSyncCommands', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('reports every command as applied when the request succeeds', async () => {
        const commands = createCommands()
        mockTodoistApi.sync.mockResolvedValue({
            syncStatus: { [commands[0]?.uuid ?? '']: 'ok', [commands[1]?.uuid ?? '']: 'ok' },
            tempIdMapping: { tempA: 'filter-a', tempB: 'filter-b' },
        })

        const result = await settleSyncCommands(mockTodoistApi, commands)

        expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
        expect(result.tempIdMapping).toEqual({ tempA: 'filter-a', tempB: 'filter-b' })
    })

    it('settles each command on its own when some of them fail', async () => {
        const commands = createCommands()
        mockTodoistApi.sync.mockRejectedValue(
            new TodoistSyncError(COMMAND_ERROR, {
                syncStatus: {
                    [commands[0]?.uuid ?? '']: 'ok',
                    [commands[1]?.uuid ?? '']: COMMAND_ERROR,
                },
                tempIdMapping: { tempA: 'filter-a' },
            }),
        )

        const result = await settleSyncCommands(mockTodoistApi, commands)

        expect(result.outcomes[0]?.status).toBe('fulfilled')
        const failed = result.outcomes[1]
        expect(failed?.status).toBe('rejected')
        const reason = failed?.status === 'rejected' ? failed.reason : undefined
        expect(reason).toBeInstanceOf(TodoistRequestError)
        expect(reason).toMatchObject({
            message: 'Invalid argument value',
            httpStatusCode: 400,
            responseData: COMMAND_ERROR,
        })
        expect(result.tempIdMapping).toEqual({ tempA: 'filter-a' })
    })

    it('fails a command that Todoist reported no status for', async () => {
        const commands = createCommands()
        mockTodoistApi.sync.mockResolvedValue({
            syncStatus: { [commands[0]?.uuid ?? '']: 'ok' },
        })

        const result = await settleSyncCommands(mockTodoistApi, commands)

        expect(result.outcomes[0]?.status).toBe('fulfilled')
        expect(result.outcomes[1]).toEqual({
            status: 'rejected',
            reason: new Error('Todoist did not report whether this change was applied'),
        })
    })

    it('fails every command when the request itself fails', async () => {
        const requestError = new Error('Network down')
        mockTodoistApi.sync.mockRejectedValue(requestError)

        const result = await settleSyncCommands(mockTodoistApi, createCommands())

        expect(result.outcomes).toEqual([
            { status: 'rejected', reason: requestError },
            { status: 'rejected', reason: requestError },
        ])
        expect(result.tempIdMapping).toEqual({})
    })
})
