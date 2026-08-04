import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapComment, mapProject, mapTask } from '../tool-helpers.js'
import {
    ChildrenOutputSchema,
    formatChildrenSummary,
    getProjectChildren,
    getTaskChildren,
    resolveChildren,
} from '../utils/children.js'
import {
    CommentSchema,
    ProjectSchema,
    SectionSchema,
    TaskSchema,
    toSectionSummary,
} from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

const ObjectTypes = ['task', 'project', 'comment', 'section'] as const

const ArgsSchema = {
    type: z.enum(ObjectTypes).describe('The type of object to fetch.'),
    id: z.string().min(1).describe('The unique ID of the object to fetch.'),
    includeChildren: z
        .boolean()
        .optional()
        .describe(
            'Also return the direct children of the object: subtasks for a task, sub-projects for a project. Returns childCount plus a compact list, flagging each child that has children of its own. Use this to check whether a task hides subtasks instead of a speculative find-tasks lookup. Ignored for comments and sections.',
        ),
}

const OutputSchema = {
    type: z.enum(ObjectTypes).describe('The type of object fetched.'),
    id: z.string().describe('The ID of the fetched object.'),
    object: z
        .union([TaskSchema, ProjectSchema, CommentSchema, SectionSchema])
        .describe('The fetched object data.'),
    ...ChildrenOutputSchema,
}

const fetchObject = {
    name: ToolNames.FETCH_OBJECT,
    description:
        'Fetch a single task, project, comment, or section by its ID. Use this when you have a specific object ID and want to retrieve its full details. Set includeChildren to also get its direct subtasks or sub-projects.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { type, id, includeChildren } = args

        try {
            switch (type) {
                case 'task': {
                    // Subtasks are looked up by parent id alone, so both requests
                    // can go out at once rather than one after the other.
                    const [task, children] = await Promise.all([
                        client.getTask(id),
                        includeChildren
                            ? resolveChildren(() => getTaskChildren(client, id))
                            : Promise.resolve({}),
                    ])
                    const mappedTask = mapTask(task)
                    return {
                        textContent: `Found task: ${mappedTask.content} • id=${mappedTask.id} • priority=${mappedTask.priority} • project=${mappedTask.projectId}${formatChildrenSummary('subtasks', children)}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedTask,
                            ...children,
                        },
                    }
                }
                case 'project': {
                    const project = await client.getProject(id)
                    const mappedProject = mapProject(project)
                    const children = includeChildren
                        ? await resolveChildren(() => getProjectChildren(client, project))
                        : {}
                    return {
                        textContent: `Found project: ${mappedProject.name} • id=${mappedProject.id} • color=${mappedProject.color} • viewStyle=${mappedProject.viewStyle}${formatChildrenSummary('subProjects', children)}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedProject,
                            ...children,
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

                    const mappedSection = toSectionSummary(section)
                    return {
                        textContent: `Found section: ${mappedSection.name} • id=${mappedSection.id}`,
                        structuredContent: {
                            type,
                            id,
                            object: mappedSection,
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
