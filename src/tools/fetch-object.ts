import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapComment, mapProject, mapTask } from '../tool-helpers.js'
import {
    CommentSchema,
    GoalSchema,
    ProjectSchema,
    SectionSchema,
    TaskSchema,
} from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const ObjectTypes = ['task', 'project', 'comment', 'section', 'goal'] as const

const ArgsSchema = {
    type: z.enum(ObjectTypes).describe('The type of object to fetch.'),
    id: z.string().min(1).describe('The unique ID of the object to fetch.'),
}

const OutputSchema = {
    type: z.enum(ObjectTypes).describe('The type of object fetched.'),
    id: z.string().describe('The ID of the fetched object.'),
    object: z
        .union([TaskSchema, ProjectSchema, CommentSchema, SectionSchema, GoalSchema])
        .describe('The fetched object data.'),
}

const fetchObject = {
    name: ToolNames.FETCH_OBJECT,
    description:
        'Fetch a single task, project, comment, section, or goal by its ID. Use this when you have a specific object ID and want to retrieve its full details.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { type, id } = args

        try {
            switch (type) {
                case 'task': {
                    const task = await client.getTask(id)
                    const mappedTask = mapTask(task)
                    return {
                        textContent: `Found task: ${mappedTask.content} • id=${mappedTask.id} • priority=${mappedTask.priority} • project=${mappedTask.projectId}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedTask,
                        },
                    }
                }
                case 'project': {
                    const project = await client.getProject(id)
                    const mappedProject = mapProject(project)
                    return {
                        textContent: `Found project: ${mappedProject.name} • id=${mappedProject.id} • color=${mappedProject.color} • viewStyle=${mappedProject.viewStyle}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedProject,
                        },
                    }
                }
                case 'comment': {
                    const comment = await client.getComment(id)
                    const mappedComment = mapComment(comment)
                    const truncatedContent =
                        mappedComment.content.length > 50
                            ? `${mappedComment.content.substring(0, 50)}...`
                            : mappedComment.content
                    return {
                        textContent: `Found comment • id=${mappedComment.id} • content="${truncatedContent}" • posted=${mappedComment.postedAt}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedComment,
                        },
                    }
                }
                case 'section': {
                    const section = await client.getSection(id)

                    if (!section) {
                        throw new Error(`Section ${id} not found.`)
                    }

                    const mappedSection = {
                        id: section.id,
                        name: section.name,
                    }
                    return {
                        textContent: `Found section: ${mappedSection.name} • id=${mappedSection.id}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedSection,
                        },
                    }
                }
                case 'goal': {
                    const goal = await client.getGoal(id)
                    const mappedGoal = {
                        id: goal.id,
                        name: goal.name,
                        ownerType: goal.ownerType,
                        ownerId: goal.ownerId,
                        description: goal.description,
                        deadline: goal.deadline,
                        isCompleted: goal.isCompleted,
                        progress: goal.progress,
                    }
                    return {
                        textContent: `Found goal: ${mappedGoal.name} • id=${mappedGoal.id} • progress=${mappedGoal.progress.percentage}%`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedGoal,
                        },
                    }
                }
            }
        } catch (error) {
            throw new Error(
                `Failed to fetch ${type} with id ${id}: ${error instanceof Error ? error.message : String(error)}`,
            )
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { fetchObject }
