import { getProjectUrl, getTaskUrl } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapProject, mapTask } from '../tool-helpers.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    id: z
        .string()
        .min(1)
        .describe(
            'A unique identifier for the document in the format "task:{id}" or "project:{id}".',
        ),
}

type FetchResult = {
    id: string
    title: string
    text: string
    url: string
    metadata?: Record<string, unknown>
}

const OutputSchema = {
    id: z.string().describe('The ID of the fetched document.'),
    title: z.string().describe('The title of the document.'),
    text: z.string().describe('The text content of the document.'),
    url: z.string().describe('The URL of the document.'),
    metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Additional metadata about the document.'),
}

/**
 * OpenAI MCP fetch tool - retrieves the full contents of a task or project by ID.
 *
 * This tool follows the OpenAI MCP fetch tool specification:
 * @see https://platform.openai.com/docs/mcp#fetch-tool
 */
const fetch = {
    name: ToolNames.FETCH,
    description:
        'Fetch the full contents of a task or project by its ID. The ID should be in the format "task:{id}" or "project:{id}".',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { id } = args

        // Parse the composite ID
        const [type, objectId] = id.split(':', 2)

        if (!objectId || (type !== 'task' && type !== 'project')) {
            throw new Error(
                'Invalid ID format. Expected "task:{id}" or "project:{id}". Example: "task:8485093748" or "project:6cfCcrrCFg2xP94Q"',
            )
        }

        let result: FetchResult

        if (type === 'task') {
            // Fetch task
            const task = await client.getTask(objectId)
            const mappedTask = mapTask(task)

            // Build text content
            const textParts = [mappedTask.content]
            if (mappedTask.description) {
                textParts.push(`\n\nDescription: ${mappedTask.description}`)
            }
            if (mappedTask.dueDate) {
                textParts.push(`\nDue: ${mappedTask.dueDate}`)
            }
            if (mappedTask.labels.length > 0) {
                textParts.push(`\nLabels: ${mappedTask.labels.join(', ')}`)
            }

            result = {
                id: `task:${mappedTask.id}`,
                title: mappedTask.content,
                text: textParts.join(''),
                url: getTaskUrl(mappedTask.id),
                metadata: {
                    priority: mappedTask.priority,
                    projectId: mappedTask.projectId,
                    sectionId: mappedTask.sectionId,
                    parentId: mappedTask.parentId,
                    recurring: mappedTask.recurring,
                    duration: mappedTask.duration,
                    responsibleUid: mappedTask.responsibleUid,
                    assignedByUid: mappedTask.assignedByUid,
                    checked: mappedTask.checked,
                    completedAt: mappedTask.completedAt,
                },
            }
        } else {
            // Fetch project
            const project = await client.getProject(objectId)
            const mappedProject = mapProject(project)

            // Build text content
            const textParts = [mappedProject.name]
            if (mappedProject.description) {
                textParts.push(`\n\nDescription: ${mappedProject.description}`)
            }
            if (mappedProject.isShared) {
                textParts.push('\n\nShared project')
            }
            if (mappedProject.isFavorite) {
                textParts.push('\nFavorite: Yes')
            }

            result = {
                id: `project:${mappedProject.id}`,
                title: mappedProject.name,
                text: textParts.join(''),
                url: getProjectUrl(mappedProject.id),
                metadata: {
                    color: mappedProject.color,
                    isFavorite: mappedProject.isFavorite,
                    isShared: mappedProject.isShared,
                    parentId: mappedProject.parentId,
                    inboxProject: mappedProject.inboxProject,
                    viewStyle: mappedProject.viewStyle,
                },
            }
        }

        return {
            textContent: JSON.stringify(result),
            structuredContent: result,
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { fetch }
