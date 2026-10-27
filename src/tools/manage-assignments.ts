import type { Task } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import {
    type Assignment,
    assignmentValidator,
    type ValidationResult,
} from '../utils/assignment-validator.js'
import { ToolNames } from '../utils/tool-names.js'
import { userResolver } from '../utils/user-resolver.js'

const { FIND_TASKS, FIND_PROJECT_COLLABORATORS, UPDATE_TASKS } = ToolNames

// Maximum tasks per operation to prevent abuse and timeouts
const MAX_TASKS_PER_OPERATION = 50

const ArgsSchema = {
    operation: z
        .enum(['assign', 'unassign', 'reassign'])
        .describe('The assignment operation to perform.'),
    taskIds: z
        .array(z.string())
        .min(1)
        .max(MAX_TASKS_PER_OPERATION)
        .describe('The IDs of the tasks to operate on (max 50).'),
    responsibleUser: z
        .string()
        .optional()
        .describe(
            'The user to assign tasks to. Can be "me" (assigns to current user), a user ID, name, or email. Required for assign and reassign operations.',
        ),
    fromAssigneeUser: z
        .string()
        .optional()
        .describe(
            'For reassign operations: the current assignee to reassign from. Can be user ID, name, or email. Optional - if not provided, reassigns from any current assignee.',
        ),
    dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, validates operations without executing them.'),
}

export type OperationResult = {
    taskId: string
    success: boolean
    error?: string
    originalAssigneeId?: string
    newAssigneeId?: string
}

const OutputSchema = {
    results: z
        .array(
            z.object({
                taskId: z.string().describe('The ID of the task.'),
                success: z.boolean().describe('Whether the operation was successful.'),
                error: z.string().optional().describe('Error message if the operation failed.'),
                originalAssigneeId: z
                    .string()
                    .optional()
                    .describe('The original assignee ID before the operation.'),
                newAssigneeId: z
                    .string()
                    .optional()
                    .describe('The new assignee ID after the operation.'),
            }),
        )
        .describe('Results of the assignment operations.'),
    summary: z
        .object({
            total: z.number().describe('Total number of tasks processed.'),
            succeeded: z.number().describe('Number of successful operations.'),
            failed: z.number().describe('Number of failed operations.'),
            dryRun: z.boolean().describe('Whether this was a dry run.'),
        })
        .optional()
        .describe('Summary of the operation.'),
}

const manageAssignments = {
    name: ToolNames.MANAGE_ASSIGNMENTS,
    description:
        "Assign, unassign or reassign up to 50 tasks at once. Assigning notifies the new assignee. Each task is updated independently, so one failure does not undo the others; every task's outcome is reported in the results. Use dryRun to check the changes first.",
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    // Open world: assigning a task notifies the new assignee.
    annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
    },
    async execute(args, client) {
        const { operation, taskIds, responsibleUser, fromAssigneeUser, dryRun } = args

        // Validate required parameters based on operation
        if ((operation === 'assign' || operation === 'reassign') && !responsibleUser) {
            throw new Error(`${operation} operation requires responsibleUser parameter`)
        }

        // Fetch all tasks first to validate they exist and get project information
        const tasks = await Promise.allSettled(
            taskIds.map(async (taskId) => {
                try {
                    return await client.getTask(taskId)
                } catch (_error) {
                    throw new Error(`Task ${taskId} not found or not accessible`)
                }
            }),
        )

        const validTasks: Task[] = []
        const taskErrors: OperationResult[] = []

        for (let i = 0; i < tasks.length; i++) {
            const result = tasks[i]
            if (result && result.status === 'fulfilled') {
                validTasks.push(result.value)
            } else if (result && result.status === 'rejected') {
                taskErrors.push({
                    taskId: taskIds[i] || 'invalid-task-id',
                    success: false,
                    error: result.reason?.message || 'Task not accessible',
                })
            } else {
                taskErrors.push({
                    taskId: taskIds[i] || 'invalid-task-id',
                    success: false,
                    error: 'Task not accessible',
                })
            }
        }

        if (validTasks.length === 0) {
            const details = taskErrors.map((r) => `"${r.taskId}": ${r.error}`).join('; ')
            throw new Error(`All ${taskErrors.length} task(s) failed: ${details}`)
        }

        // Pre-resolve fromAssigneeUser once for reassign operations
        let resolvedFromUserId: string | undefined
        if (operation === 'reassign' && fromAssigneeUser) {
            const fromUser = await userResolver.resolveUser(client, fromAssigneeUser)
            resolvedFromUserId = fromUser?.userId || fromAssigneeUser
        }

        // Build assignments for validation
        const assignments: Assignment[] = []
        for (const task of validTasks) {
            // For reassign operations, check if we need to filter by current assignee
            if (operation === 'reassign' && resolvedFromUserId) {
                // Skip tasks not assigned to the specified user
                if (task.responsibleUid !== resolvedFromUserId) {
                    continue
                }
            }

            assignments.push({
                taskId: task.id,
                projectId: task.projectId,
                responsibleUid: responsibleUser || '', // Will be validated appropriately
            })
        }

        // Handle unassign operations (no validation needed for unassignment)
        if (operation === 'unassign') {
            if (dryRun) {
                const results: OperationResult[] = validTasks.map((task) => ({
                    taskId: task.id,
                    success: true,
                    originalAssigneeId: task.responsibleUid ?? undefined,
                    newAssigneeId: undefined,
                }))

                const textContent = generateTextContent({
                    operation,
                    results,
                    dryRun: true,
                })

                return {
                    textContent,
                    structuredContent: {
                        operation,
                        results,
                        totalRequested: taskIds.length,
                        successful: results.length,
                        failed: taskErrors.length,
                        dryRun: true,
                    },
                }
            }

            // Execute unassign operations
            const unassignPromises = validTasks.map(async (task): Promise<OperationResult> => {
                try {
                    await client.updateTask(task.id, { assigneeId: null })
                    return {
                        taskId: task.id,
                        success: true,
                        originalAssigneeId: task.responsibleUid ?? undefined,
                        newAssigneeId: undefined,
                    }
                } catch (error) {
                    return {
                        taskId: task.id,
                        success: false,
                        error: error instanceof Error ? error.message : 'Update failed',
                        originalAssigneeId: task.responsibleUid ?? undefined,
                    }
                }
            })

            const unassignResults = await Promise.all(unassignPromises)
            const allResults = [...unassignResults, ...taskErrors]

            // If all operations failed, throw so MCP clients see isError: true
            // Guard against empty allResults (e.g. reassign filtered out all tasks via fromAssigneeUser)
            if (allResults.length > 0 && allResults.every((r) => !r.success)) {
                const details = allResults.map((r) => `"${r.taskId}": ${r.error}`).join('; ')
                throw new Error(`All ${allResults.length} unassign operation(s) failed: ${details}`)
            }

            const textContent = generateTextContent({
                operation,
                results: allResults,
                dryRun: false,
            })

            return {
                textContent,
                structuredContent: {
                    operation,
                    results: allResults,
                    totalRequested: taskIds.length,
                    successful: unassignResults.filter((r) => r.success).length,
                    failed: allResults.filter((r) => !r.success).length,
                    dryRun: false,
                },
            }
        }

        // Validate all assignments
        const validationResults = await assignmentValidator.validateBulkAssignment(
            client,
            assignments,
        )

        // Process validation results
        const validAssignments: { assignment: Assignment; validation: ValidationResult }[] = []
        const validationErrors: OperationResult[] = []

        for (let i = 0; i < assignments.length; i++) {
            const assignment = assignments[i]
            const validation = validationResults[i]

            if (assignment && validation?.isValid) {
                validAssignments.push({ assignment, validation })
            } else if (assignment?.taskId) {
                validationErrors.push({
                    taskId: assignment.taskId,
                    success: false,
                    error: validation?.error?.message || 'Validation failed',
                })
            }
        }

        // Helper function to process assignments for both dry run and execution
        async function processAssignments(
            assignments: { assignment: Assignment; validation: ValidationResult }[],
            execute: boolean,
        ): Promise<OperationResult[]> {
            const filteredAssignments = assignments.filter(
                (item): item is { assignment: Assignment; validation: ValidationResult } =>
                    item.assignment != null && item.validation != null,
            )

            if (!execute) {
                // Dry run: just map to successful results
                return filteredAssignments.map(({ assignment, validation }) => {
                    const task = validTasks.find((t: Task) => t.id === assignment.taskId)
                    if (!assignment.taskId || !validation.resolvedUser?.userId) {
                        throw new Error(
                            'Invalid assignment or validation data - this should not happen',
                        )
                    }
                    return {
                        taskId: assignment.taskId,
                        success: true,
                        originalAssigneeId: task?.responsibleUid ?? undefined,
                        newAssigneeId: validation.resolvedUser.userId,
                    }
                })
            }

            // Execute: perform actual updates
            const executePromises = filteredAssignments.map(
                async ({ assignment, validation }): Promise<OperationResult> => {
                    const task = validTasks.find((t: Task) => t.id === assignment.taskId)

                    if (!assignment.taskId || !validation.resolvedUser?.userId) {
                        return {
                            taskId: assignment.taskId || 'unknown-task',
                            success: false,
                            error: 'Invalid assignment data - missing task ID or resolved user',
                            originalAssigneeId: task?.responsibleUid ?? undefined,
                        }
                    }

                    try {
                        await client.updateTask(assignment.taskId, {
                            assigneeId: validation.resolvedUser.userId,
                        })

                        return {
                            taskId: assignment.taskId,
                            success: true,
                            originalAssigneeId: task?.responsibleUid ?? undefined,
                            newAssigneeId: validation.resolvedUser.userId,
                        }
                    } catch (error) {
                        return {
                            taskId: assignment.taskId,
                            success: false,
                            error: error instanceof Error ? error.message : 'Update failed',
                            originalAssigneeId: task?.responsibleUid ?? undefined,
                        }
                    }
                },
            )

            return Promise.all(executePromises)
        }

        // Handle assign/reassign operations - validate then execute
        const assignmentResults = await processAssignments(validAssignments, !dryRun)
        const allResults = [...assignmentResults, ...validationErrors, ...taskErrors]

        // If all operations failed, throw so MCP clients see isError: true
        // Guard against empty allResults (e.g. reassign filtered out all tasks via fromAssigneeUser)
        if (allResults.length > 0 && allResults.every((r) => !r.success)) {
            const details = allResults.map((r) => `"${r.taskId}": ${r.error}`).join('; ')
            throw new Error(`All ${allResults.length} ${operation} operation(s) failed: ${details}`)
        }

        const textContent = generateTextContent({
            operation,
            results: allResults,
            dryRun,
        })

        return {
            textContent,
            structuredContent: {
                operation,
                results: allResults,
                totalRequested: taskIds.length,
                successful: assignmentResults.filter((r) => r.success).length,
                failed: allResults.filter((r) => !r.success).length,
                dryRun,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    operation,
    results,
    dryRun,
}: {
    operation: 'assign' | 'unassign' | 'reassign'
    results: OperationResult[]
    dryRun: boolean
}) {
    const successful = results.filter((r) => r.success)
    const failed = results.filter((r) => !r.success)

    const operationVerb = dryRun ? 'would be' : 'were'
    const operationPastTense = {
        assign: 'assigned',
        unassign: 'unassigned',
        reassign: 'reassigned',
    }[operation]

    let summary = `**${dryRun ? 'Dry Run: ' : ''}Bulk ${operation} operation**\n\n`

    if (successful.length > 0) {
        summary += `**${successful.length} task${successful.length === 1 ? '' : 's'} ${operationVerb} successfully ${operationPastTense}**\n`

        // Show first few successful operations
        const preview = successful.slice(0, 5)
        for (const result of preview) {
            let changeDesc = ''
            if (operation === 'unassign') {
                changeDesc = ' (unassigned from previous assignee)'
            } else if (result.newAssigneeId) {
                changeDesc = ` → ${result.newAssigneeId}`
            }
            summary += `  • Task ${result.taskId}${changeDesc}\n`
        }

        if (successful.length > 5) {
            summary += `  • ... and ${successful.length - 5} more\n`
        }
        summary += '\n'
    }

    if (failed.length > 0) {
        summary += `**${failed.length} task${failed.length === 1 ? '' : 's'} failed**\n`

        // Show first few failures with reasons
        const preview = failed.slice(0, 5)
        for (const result of preview) {
            summary += `  • Task ${result.taskId}: ${result.error}\n`
        }

        if (failed.length > 5) {
            summary += `  • ... and ${failed.length - 5} more failures\n`
        }
        summary += '\n'
    }

    // Add operational info
    if (!dryRun && successful.length > 0) {
        summary += '**Next steps:**\n'
        summary += `• Use ${FIND_TASKS} with responsibleUser to see ${operation === 'unassign' ? 'unassigned' : 'newly assigned'} tasks\n`
        summary += `• Use ${UPDATE_TASKS} for individual assignment changes\n`

        if (failed.length > 0) {
            summary += `• Check failed tasks and use ${FIND_PROJECT_COLLABORATORS} to verify collaborator access\n`
        }
    } else if (dryRun) {
        summary += '**To execute:**\n'
        summary += '• Remove dryRun parameter and run again to execute changes\n'
        if (successful.length > 0) {
            summary += `• ${successful.length} task${successful.length === 1 ? '' : 's'} ready for ${operation} operation\n`
        }
        if (failed.length > 0) {
            summary += `• Fix ${failed.length} validation error${failed.length === 1 ? '' : 's'} before executing\n`
        }
    } else if (successful.length === 0) {
        summary += '**Suggestions:**\n'
        summary += `• Use ${FIND_PROJECT_COLLABORATORS} to find valid assignees\n`
        summary += '• Check task IDs and assignee permissions\n'
        summary += '• Use dryRun=true to validate before executing\n'
    }

    return summary
}

export { manageAssignments }
