import {
    DURATION_UNITS,
    PROJECT_VIEW_STYLES,
    type TemplateContent,
    type TemplateContentDate,
} from '@todoist/sdk'
import { z } from 'zod'
import { convertNumberToPriority, convertPriorityToNumber, PRIORITY_VALUES } from './priorities.js'

// get-template returns complete dates; a new date can be just `string`. Send dates back as
// received so their type, time and timezone are kept.
const ContentDateSchema = z.object({
    date: z.string().optional().describe('ISO date or datetime.'),
    string: z.string().optional().describe('e.g. "every monday at 9am".'),
    lang: z.string().optional(),
    isRecurring: z.boolean().optional(),
    timezone: z.string().optional(),
})

const ContentCommentFields = {
    content: z.string(),
    postedUid: z.string().optional(),
    postedAt: z.string().optional(),
    fileAttachment: z.record(z.string(), z.unknown()).optional(),
}

/**
 * A template's full content, as get-template returns it and update-template takes it back.
 * IDs are references within the content only.
 */
const TemplateContentSchema = z.object({
    projects: z
        .array(
            z.object({
                viewStyle: z.enum(PROJECT_VIEW_STYLES),
                description: z.string().optional(),
                icon: z.string().optional(),
            }),
        )
        .describe('The project the template creates. Always one.'),
    sections: z.array(
        z.object({ id: z.string(), name: z.string(), description: z.string().optional() }),
    ),
    tasks: z
        .array(
            z.object({
                id: z.string(),
                content: z.string(),
                description: z.string().optional(),
                sectionId: z.string().optional(),
                parentId: z.string().optional(),
                priority: z.enum(PRIORITY_VALUES).optional().describe('p1 is the highest.'),
                labels: z.array(z.string()).optional(),
                due: ContentDateSchema.optional(),
                deadline: ContentDateSchema.optional(),
                duration: z.object({ amount: z.number(), unit: z.enum(DURATION_UNITS) }).optional(),
                responsibleUid: z.string().optional().describe('Assignee user ID.'),
                assignedByUid: z.string().optional(),
            }),
        )
        .describe('In order. New tasks can use any ID that is unique in the content.'),
    comments: z.array(z.object({ taskId: z.string(), ...ContentCommentFields })),
    projectComments: z.array(z.object(ContentCommentFields)),
    projectViewOptionsDefaults: z
        .array(z.record(z.string(), z.unknown()))
        .describe('Calendar settings. Send back as received.'),
})

type ToolTemplateContent = z.infer<typeof TemplateContentSchema>

/** Turns the SDK's template content into the tools' shape: "p1"–"p4" priorities, no nulls. */
function toToolTemplateContent(content: TemplateContent): ToolTemplateContent {
    return {
        projects: content.projects.map((project) => ({
            viewStyle: project.viewStyle,
            description: project.description ?? undefined,
            icon: project.icon ?? undefined,
        })),
        sections: content.sections.map((section) => ({
            id: section.id,
            name: section.name,
            description: section.description ?? undefined,
        })),
        tasks: content.tasks.map((task) => ({
            id: task.id,
            content: task.content,
            description: task.description ?? undefined,
            sectionId: task.sectionId ?? undefined,
            parentId: task.parentId ?? undefined,
            priority:
                task.priority === undefined ? undefined : convertNumberToPriority(task.priority),
            labels: task.labels,
            due: toToolDate(task.due),
            deadline: toToolDate(task.deadline),
            duration: task.duration ?? undefined,
            responsibleUid: task.responsibleUid ?? undefined,
            assignedByUid: task.assignedByUid ?? undefined,
        })),
        comments: content.comments.map(({ taskId, ...comment }) => ({
            taskId,
            ...toToolComment(comment),
        })),
        projectComments: content.projectComments.map(toToolComment),
        projectViewOptionsDefaults: content.projectViewOptionsDefaults,
    }
}

function toToolDate(date: TemplateContentDate | null | undefined) {
    if (!date) {
        return undefined
    }
    return {
        date: date.date,
        string: date.string,
        lang: date.lang ?? undefined,
        isRecurring: date.isRecurring,
        timezone: date.timezone ?? undefined,
    }
}

function toToolComment(comment: TemplateContent['projectComments'][number]) {
    return {
        content: comment.content,
        postedUid: comment.postedUid ?? undefined,
        postedAt: comment.postedAt ?? undefined,
        fileAttachment: comment.fileAttachment ?? undefined,
    }
}

/** Turns the tools' template content back into the SDK's shape. */
function toSdkTemplateContent(content: ToolTemplateContent): TemplateContent {
    return {
        ...content,
        tasks: content.tasks.map(({ priority, ...task }) => ({
            ...task,
            ...(priority ? { priority: convertPriorityToNumber(priority) } : {}),
        })),
    }
}

/**
 * One line comparing two contents, so a dropped task, comment or assignee shows up in the reply.
 * The backend drops assignees who are no longer workspace members, so compare against the saved
 * content where possible.
 */
function describeContentChange(before: TemplateContent, after: TemplateContent): string {
    const layout = (content: TemplateContent) => content.projects[0]?.viewStyle ?? 'none'
    const count = (label: string, from: number, to: number) => `${label} ${from} → ${to}`
    return [
        `layout ${layout(before)} → ${layout(after)}`,
        count('sections', before.sections.length, after.sections.length),
        count('tasks', before.tasks.length, after.tasks.length),
        count(
            'assigned tasks',
            before.tasks.filter((task) => task.responsibleUid).length,
            after.tasks.filter((task) => task.responsibleUid).length,
        ),
        count(
            'comments',
            before.comments.length + before.projectComments.length,
            after.comments.length + after.projectComments.length,
        ),
    ].join(', ')
}

const MAX_OUTLINED_TASKS = 20

/**
 * A short text outline of template content for a tool's reply: layout, counts and the first
 * tasks, with their section, nesting and due date.
 */
function outlineTemplateContent(content: ToolTemplateContent): string {
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
    const layout = content.projects[0]?.viewStyle ?? 'list'
    const sectionNames = new Map(content.sections.map((section) => [section.id, section.name]))
    const lines = [
        `${layout} layout, ${plural(content.sections.length, 'section')}, ${plural(content.tasks.length, 'task')}.`,
        ...content.tasks.slice(0, MAX_OUTLINED_TASKS).map((task) => {
            const indent = task.parentId ? '    ' : ''
            const section = task.sectionId
                ? ` [${sectionNames.get(task.sectionId) ?? task.sectionId}]`
                : ''
            const due = task.due?.string ? ` (due ${task.due.string})` : ''
            return `${indent}- ${task.content}${section}${due}`
        }),
    ]
    const remaining = content.tasks.length - MAX_OUTLINED_TASKS
    if (remaining > 0) {
        lines.push(`… ${plural(remaining, 'more task')} in the full content.`)
    }
    return lines.join('\n')
}

export {
    describeContentChange,
    outlineTemplateContent,
    TemplateContentSchema,
    toSdkTemplateContent,
    toToolTemplateContent,
    type ToolTemplateContent,
}
