import { type App as McpApp, useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { z } from 'zod'
import { ArgsSchema } from '../../tools/find-tasks-by-date.js'
import { ToolNames } from '../../utils/tool-names.js'
import { Empty } from './empty'
import { Loading } from './loading'
import { loadRemainingPages } from './pagination'
import { TaskList } from './task-list'
import type { Task } from './types'
import styles from './task-list.module.css'

type FindTasksByDateArgs = z.input<z.ZodObject<typeof ArgsSchema>>

type ToolOutput = {
    tasks: Task[]
    nextCursor?: string
    appliedFilters?: FindTasksByDateArgs
}

type ToolResult = {
    isError?: boolean
    structuredContent?: unknown
    content?: Array<{ type?: string; text?: string }>
}

type PaginationRequest = {
    args: Omit<FindTasksByDateArgs, 'cursor'>
    cursor: string
    requestId: number
}

const TODOIST_APP_URL = 'https://app.todoist.com/app'

function getInvocationArgs(args: FindTasksByDateArgs | null | undefined) {
    if (!args) {
        return null
    }

    const { cursor: _cursor, ...rest } = args
    return Object.keys(rest).length > 0 ? rest : null
}

function getToolResultMessage(result: ToolResult, fallback: string) {
    const message = result.content?.find((item) => item.type === 'text' && item.text)?.text?.trim()
    return message && message.length > 0 ? message : fallback
}

async function fetchTaskPage(
    app: McpApp,
    args: Omit<FindTasksByDateArgs, 'cursor'>,
    cursor: string,
): Promise<ToolOutput> {
    const result = await app.callServerTool({
        name: ToolNames.FIND_TASKS_BY_DATE,
        arguments: { ...args, cursor },
    })

    if (result.isError) {
        throw new Error(getToolResultMessage(result as ToolResult, 'Failed to load more tasks.'))
    }

    if (!result.structuredContent) {
        throw new Error('Task page data was missing from the tool result.')
    }

    return result.structuredContent as ToolOutput
}

function OpenInTodoistIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M5.02511 4.81798C5.02511 5.09412 5.24897 5.31798 5.52511 5.31798L9.97486 5.31798L4.4291 10.8637C4.25336 11.0395 4.26919 11.3402 4.46445 11.5355C4.65971 11.7308 4.96047 11.7466 5.1362 11.5709L10.682 6.02509L10.682 10.4748C10.682 10.751 10.9058 10.9748 11.182 10.9748C11.4581 10.9748 11.682 10.751 11.682 10.4748V4.81798C11.682 4.54184 11.4581 4.31798 11.182 4.31798L5.52511 4.31798C5.24897 4.31798 5.02511 4.54184 5.02511 4.81798Z"
                fill="currentColor"
            />
        </svg>
    )
}

function OpenInTodoistButton({ onClick }: { onClick: () => void }) {
    return (
        <button type="button" className={styles.openInTodoistButton} onClick={onClick}>
            Open in Todoist
            <OpenInTodoistIcon />
        </button>
    )
}

export function App() {
    const [tasks, setTasks] = useState<Task[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [lastArgs, setLastArgs] = useState<Omit<FindTasksByDateArgs, 'cursor'> | null>(null)
    const [toolError, setToolError] = useState<string | null>(null)
    const [paginationError, setPaginationError] = useState<string | null>(null)
    const [paginationRequest, setPaginationRequest] = useState<PaginationRequest | null>(null)
    const requestId = useRef(0)

    const handleToolOutput = useCallback((output: ToolOutput) => {
        const args = getInvocationArgs(output.appliedFilters)

        setTasks(output.tasks)
        setLastArgs(args)
        setToolError(null)
        setPaginationError(null)
        setPaginationRequest(
            output.nextCursor && args
                ? { args, cursor: output.nextCursor, requestId: requestId.current }
                : null,
        )
        setLoading(false)
    }, [])

    const { app, isConnected, error } = useApp({
        appInfo: { name: 'todoist-task-list', version: '1.0.0' },
        capabilities: {},
        onAppCreated: (app) => {
            app.ontoolinput = (params) => {
                requestId.current += 1
                setLoading(true)
                setToolError(null)
                setPaginationError(null)
                setTasks(null)
                setPaginationRequest(null)
                setLastArgs(getInvocationArgs((params.arguments ?? {}) as FindTasksByDateArgs))
            }

            app.ontoolresult = (params) => {
                if (!params.isError && params.structuredContent) {
                    handleToolOutput(params.structuredContent as ToolOutput)
                    return
                }

                setToolError(
                    getToolResultMessage(
                        params as ToolResult,
                        params.isError
                            ? 'Failed to load tasks.'
                            : 'Task list data was missing from the tool result.',
                    ),
                )
                setLoading(false)
            }
        },
    })

    useHostStyles(app, app?.getHostContext())

    useEffect(
        function loadTaskPages() {
            if (!app || !paginationRequest) {
                return
            }

            let cancelled = false

            void loadRemainingPages({
                initialCursor: paginationRequest.cursor,
                fetchPage: (cursor) => fetchTaskPage(app, paginationRequest.args, cursor),
                onPage: (page) => {
                    if (cancelled || paginationRequest.requestId !== requestId.current) {
                        return false
                    }

                    setTasks((previous) => [...(previous ?? []), ...page.tasks])
                    return true
                },
            }).catch((error: unknown) => {
                if (!cancelled && paginationRequest.requestId === requestId.current) {
                    setPaginationError(
                        error instanceof Error ? error.message : 'Failed to load more tasks.',
                    )
                }
            })

            return () => {
                cancelled = true
            }
        },
        [app, paginationRequest],
    )

    const handleComplete = useCallback(
        async (taskId: string) => {
            if (!app || !tasks) return

            const completedTaskIndex = tasks.findIndex((task) => task.id === taskId)
            const completedTask = tasks[completedTaskIndex]
            if (!completedTask) return

            const completionRequestId = requestId.current

            setTasks((previous) => previous?.filter((task) => task.id !== taskId) ?? [])
            setToolError(null)

            try {
                const result = await app.callServerTool({
                    name: ToolNames.COMPLETE_TASKS,
                    arguments: { ids: [taskId] },
                })

                if (result.isError) {
                    throw new Error(
                        getToolResultMessage(result as ToolResult, 'Failed to complete task.'),
                    )
                }
            } catch (error) {
                if (completionRequestId !== requestId.current) {
                    return
                }

                setTasks((previous) => {
                    if (!previous || previous.some((task) => task.id === taskId)) {
                        return previous
                    }

                    const insertionIndex = Math.min(completedTaskIndex, previous.length)
                    return [
                        ...previous.slice(0, insertionIndex),
                        completedTask,
                        ...previous.slice(insertionIndex),
                    ]
                })
                setToolError(error instanceof Error ? error.message : 'Failed to complete task.')
            }
        },
        [app, tasks],
    )

    const handleOpenTodoist = useCallback(async () => {
        if (!app) return
        await app.openLink({ url: TODOIST_APP_URL })
    }, [app])

    const title = useMemo(() => {
        if (!lastArgs?.startDate || lastArgs.startDate === 'today') {
            return 'Tasks for Today'
        }

        if (typeof lastArgs.startDate === 'string') {
            return `Tasks for ${lastArgs.startDate}`
        }

        return 'Tasks'
    }, [lastArgs])

    if (error) return <div className={styles.error}>Failed to connect</div>
    if (!isConnected || loading) return <Loading />
    if (toolError) return <div className={styles.error}>{toolError}</div>
    if (!tasks) return <div className={styles.error}>Task list data was unavailable.</div>

    if (tasks.length === 0) {
        return (
            <div className={styles.widgetContainer}>
                <div className={styles.contentColumn}>
                    <Empty />
                </div>
                <OpenInTodoistButton onClick={handleOpenTodoist} />
            </div>
        )
    }

    return (
        <div className={styles.widgetContainer}>
            <div className={styles.contentColumn}>
                <h1 className={styles.widgetTitle}>{title}</h1>
                {paginationError ? (
                    <div className={styles.paginationError}>{paginationError}</div>
                ) : null}
                <TaskList tasks={tasks} onCompleteTask={handleComplete} />
            </div>
            <OpenInTodoistButton onClick={handleOpenTodoist} />
        </div>
    )
}
