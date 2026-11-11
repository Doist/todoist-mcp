import type { TodoistApi } from '@todoist/sdk'
import { type Project } from '../tool-helpers.js'
import { type ResolvedUser, userResolver } from './user-resolver.js'

export const AssignmentErrorType = {
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    USER_NOT_COLLABORATOR: 'USER_NOT_COLLABORATOR',
    PROJECT_NOT_SHARED: 'PROJECT_NOT_SHARED',
    TASK_NOT_ACCESSIBLE: 'TASK_NOT_ACCESSIBLE',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
    TASK_NOT_FOUND: 'TASK_NOT_FOUND',
} as const

export type AssignmentErrorType = (typeof AssignmentErrorType)[keyof typeof AssignmentErrorType]

export type ValidationError = {
    type: AssignmentErrorType
    message: string
    suggestions?: string[]
}

export type ValidationResult = {
    isValid: boolean
    resolvedUser?: ResolvedUser
    error?: ValidationError
    taskId?: string
    projectId?: string
}

export type Assignment = {
    taskId?: string
    projectId: string
    responsibleUid: string
}

export class AssignmentValidator {
    /**
     * Validate a single assignment operation
     */
    async validateAssignment(
        client: TodoistApi,
        assignment: Assignment,
    ): Promise<ValidationResult> {
        const { taskId, projectId, responsibleUid } = assignment

        // First, resolve the user
        const resolvedUser = await userResolver.resolveUser(client, responsibleUid)
        if (!resolvedUser) {
            return {
                isValid: false,
                taskId,
                projectId,
                error: {
                    type: AssignmentErrorType.USER_NOT_FOUND,
                    message: `User "${responsibleUid}" not found`,
                    suggestions: [
                        'Check the spelling of the user name or email',
                        'Ensure the user is a collaborator on at least one shared project',
                        "Try using the user's full email address",
                    ],
                },
            }
        }

        // Validate the project exists and is accessible
        try {
            const targetProject = await client.getProject(projectId)

            // Check if project is shared (required for assignments)
            if (!targetProject.isShared) {
                return {
                    isValid: false,
                    taskId,
                    projectId,
                    resolvedUser,
                    error: {
                        type: AssignmentErrorType.PROJECT_NOT_SHARED,
                        message: `Project "${targetProject.name}" is not shared. Task assignments require a shared project with collaborators. Share the project with at least one other person to enable assignments.`,
                        suggestions: [
                            'Share the project with at least one collaborator to enable assignments',
                            'Use find-project-collaborators to check project sharing status',
                        ],
                    },
                }
            }

            // Validate the user is a collaborator on this specific project
            const isCollaborator = await userResolver.validateProjectCollaborator(
                client,
                projectId,
                resolvedUser.userId,
            )

            if (!isCollaborator) {
                return {
                    isValid: false,
                    taskId,
                    projectId,
                    resolvedUser,
                    error: {
                        type: AssignmentErrorType.USER_NOT_COLLABORATOR,
                        message: `User "${resolvedUser.displayName}" is not a collaborator on project "${targetProject.name}"`,
                        suggestions: [
                            'Invite the user to collaborate on this project first',
                            'Check if the user has been removed from the project',
                            'Verify you have permission to see project collaborators',
                        ],
                    },
                }
            }

            // If taskId is provided, validate the task exists and is accessible
            if (taskId) {
                try {
                    await client.getTask(taskId)
                } catch (_error) {
                    return {
                        isValid: false,
                        taskId,
                        projectId,
                        resolvedUser,
                        error: {
                            type: AssignmentErrorType.TASK_NOT_FOUND,
                            message: `Task "${taskId}" not found or not accessible`,
                            suggestions: [
                                'Verify the task ID is correct',
                                'Check if the task has been deleted',
                                'Ensure you have access to the task',
                            ],
                        },
                    }
                }
            }

            return {
                isValid: true,
                taskId,
                projectId,
                resolvedUser,
            }
        } catch (_error) {
            return {
                isValid: false,
                taskId,
                projectId,
                resolvedUser,
                error: {
                    type: AssignmentErrorType.PERMISSION_DENIED,
                    message: 'Permission denied or API error occurred',
                    suggestions: [
                        'Check your API permissions',
                        'Verify you have access to the project',
                        'Try again later if this is a temporary API issue',
                    ],
                },
            }
        }
    }

    /**
     * Validate multiple assignment operations in bulk
     */
    async validateBulkAssignment(
        client: TodoistApi,
        assignments: Assignment[],
    ): Promise<ValidationResult[]> {
        // Process assignments in parallel for better performance
        const validationPromises = assignments.map((assignment) =>
            this.validateAssignment(client, assignment),
        )

        return Promise.all(validationPromises)
    }

    /**
     * Validate assignment for task creation (no taskId required)
     */
    async validateTaskCreationAssignment(
        client: TodoistApi,
        projectId: string,
        responsibleUid: string,
    ): Promise<ValidationResult> {
        return this.validateAssignment(client, {
            projectId,
            responsibleUid,
        })
    }

    /**
     * Validate assignment for task update
     */
    async validateTaskUpdateAssignment(
        client: TodoistApi,
        taskId: string,
        responsibleUid: string | null,
    ): Promise<ValidationResult> {
        // If responsibleUid is null, it's an unassignment - always valid
        if (responsibleUid === null) {
            return {
                isValid: true,
                taskId,
            }
        }

        // Get the task to find its project
        try {
            const task = await client.getTask(taskId)
            return this.validateAssignment(client, {
                taskId,
                projectId: task.projectId,
                responsibleUid,
            })
        } catch (_error) {
            return {
                isValid: false,
                taskId,
                error: {
                    type: AssignmentErrorType.TASK_NOT_FOUND,
                    message: `Task "${taskId}" not found or not accessible`,
                    suggestions: [
                        'Verify the task ID is correct',
                        'Check if the task has been deleted',
                        'Ensure you have access to the task',
                    ],
                },
            }
        }
    }

    /**
     * Get detailed assignment eligibility information for troubleshooting
     */
    async getAssignmentEligibility(
        client: TodoistApi,
        projectId: string,
        responsibleUid: string,
        taskIds?: string[],
    ): Promise<{
        canAssign: boolean
        projectInfo: {
            name: string
            isShared: boolean
            collaboratorCount: number
        }
        userInfo?: {
            resolvedName: string
            isCollaborator: boolean
        }
        taskInfo?: {
            accessibleTasks: number
            inaccessibleTasks: number
        }
        recommendations: string[]
    }> {
        const recommendations: string[] = []
        let canAssign = false

        // Get project information
        let project: Project
        try {
            project = await client.getProject(projectId)
        } catch {
            return {
                canAssign: false,
                projectInfo: {
                    name: 'Unknown',
                    isShared: false,
                    collaboratorCount: 0,
                },
                recommendations: ['Project not found or not accessible'],
            }
        }

        const collaborators = await userResolver.getProjectCollaborators(client, projectId)
        const projectInfo = {
            name: project.name,
            isShared: project.isShared,
            collaboratorCount: collaborators.length,
        }

        if (!project.isShared) {
            recommendations.push('Share this project to enable task assignments')
            return { canAssign: false, projectInfo, recommendations }
        }

        // Resolve user
        const resolvedUser = await userResolver.resolveUser(client, responsibleUid)
        if (!resolvedUser) {
            recommendations.push('User not found - check spelling or invite to a shared project')
            return { canAssign: false, projectInfo, recommendations }
        }

        const isCollaborator = collaborators.some((c) => c.id === resolvedUser.userId)
        const userInfo = {
            resolvedName: resolvedUser.displayName,
            isCollaborator,
        }

        if (!isCollaborator) {
            recommendations.push(
                `Invite ${resolvedUser.displayName} to collaborate on project "${project.name}"`,
            )
            return { canAssign: false, projectInfo, userInfo, recommendations }
        }

        // Check task accessibility if provided
        let taskInfo: { accessibleTasks: number; inaccessibleTasks: number } | undefined
        if (taskIds && taskIds.length > 0) {
            let accessible = 0
            let inaccessible = 0

            for (const taskId of taskIds) {
                try {
                    await client.getTask(taskId)
                    accessible++
                } catch {
                    inaccessible++
                }
            }

            taskInfo = { accessibleTasks: accessible, inaccessibleTasks: inaccessible }

            if (inaccessible > 0) {
                recommendations.push(`${inaccessible} task(s) are not accessible`)
            }
        }

        canAssign = true
        recommendations.push(`Ready to assign tasks to ${resolvedUser.displayName}`)

        return {
            canAssign,
            projectInfo,
            userInfo,
            taskInfo,
            recommendations,
        }
    }
}

// Export singleton instance
export const assignmentValidator = new AssignmentValidator()
