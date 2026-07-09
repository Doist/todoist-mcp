import { LOCATION_TRIGGERS, REMINDER_TYPES, type Section } from '@doist/todoist-sdk'
import { z } from 'zod'
import { ColorOutputSchema } from './colors.js'
import { PrioritySchema } from './priorities.js'

/**
 * Schema for a mapped task object returned by tools
 */
const TaskSchema = z.object({
    id: z.string().describe('The unique ID of the task.'),
    content: z.string().describe('The task title/content.'),
    description: z.string().describe('The task description.'),
    dueDate: z.string().optional().describe('The due date of the task (ISO 8601 format).'),
    recurring: z
        .union([z.boolean(), z.string()])
        .describe('Whether the task is recurring, or the recurrence string.'),
    deadlineDate: z
        .string()
        .optional()
        .describe('The deadline date of the task (ISO 8601 format).'),
    priority: PrioritySchema.describe(
        'The priority level: p1 (highest), p2 (high), p3 (medium), p4 (lowest).',
    ),
    projectId: z.string().describe('The ID of the project this task belongs to.'),
    sectionId: z.string().optional().describe('The ID of the section this task belongs to.'),
    parentId: z.string().optional().describe('The ID of the parent task (for subtasks).'),
    labels: z.array(z.string()).optional().describe('The labels attached to this task.'),
    duration: z.string().optional().describe('The duration of the task (e.g., "2h30m").'),
    responsibleUid: z
        .string()
        .optional()
        .describe('The UID of the user responsible for this task.'),
    isUncompletable: z
        .boolean()
        .optional()
        .describe('Whether the task is uncompletable (organizational header).'),
    assignedByUid: z.string().optional().describe('The UID of the user who assigned this task.'),
    checked: z.boolean().describe('Whether the task is checked/completed.'),
    completedAt: z.string().optional().describe('When the task was completed (ISO 8601 format).'),
    addedAt: z.string().optional().describe('When the task was created (ISO 8601 format).'),
})

/**
 * Schema for a mapped project object returned by tools
 */
const ProjectSchema = z.object({
    id: z.string().describe('The unique ID of the project.'),
    name: z.string().describe('The name of the project.'),
    description: z.string().describe('The description of the project (empty string if none).'),
    color: ColorOutputSchema,
    isFavorite: z.boolean().describe('Whether the project is marked as favorite.'),
    isShared: z.boolean().describe('Whether the project is shared.'),
    parentId: z.string().optional().describe('The ID of the parent project (for sub-projects).'),
    inboxProject: z.boolean().describe('Whether this is the inbox project.'),
    viewStyle: z.string().describe('The view style of the project (list, board, calendar).'),
    workspaceId: z
        .string()
        .optional()
        .describe(
            'The ID of the workspace this project belongs to (undefined for personal projects).',
        ),
    folderId: z
        .string()
        .optional()
        .describe('The ID of the folder this project belongs to (workspace projects only).'),
    childOrder: z.number().describe('The ordering index of the project among its siblings.'),
    isArchived: z.boolean().describe('Whether the project is archived.'),
})

/**
 * Schema for a section object returned by tools
 */
const SectionSchema = z.object({
    id: z.string().describe('The unique ID of the section.'),
    name: z.string().describe('The name of the section.'),
    description: z
        .string()
        .optional()
        .describe('The description of the section. Supports Markdown.'),
})

type SectionSummary = z.infer<typeof SectionSchema>

/**
 * Strip an SDK Section down to the fields declared in SectionSchema. Keeps tool
 * responses aligned with the schema. The output schema uses an optional string
 * (Gemini-compatible), so the read's `string | null` description maps `null` to
 * `undefined`.
 */
function toSectionSummary({ id, name, description }: Section): SectionSummary {
    return { id, name, description: description ?? undefined }
}

/**
 * Schema for a file attachment in a comment
 */
const AttachmentSchema = z.object({
    resourceType: z.string().describe('The type of resource (file, url, image, etc).'),
    fileName: z.string().optional().describe('The name of the file.'),
    fileSize: z.number().optional().describe('The size of the file in bytes.'),
    fileType: z.string().optional().describe('The MIME type of the file.'),
    fileUrl: z.string().optional().describe('The URL to access the file.'),
    fileDuration: z
        .number()
        .optional()
        .describe('The duration in milliseconds (for audio/video files).'),
    uploadState: z
        .enum(['pending', 'completed'])
        .optional()
        .describe('The upload state of the file.'),
    url: z.string().optional().describe('The URL for link/url resource types.'),
    title: z.string().optional().describe('The title for link/url resource types.'),
    image: z.string().optional().describe('The image URL for image resource types.'),
    imageWidth: z.number().optional().describe('The width of the image in pixels.'),
    imageHeight: z.number().optional().describe('The height of the image in pixels.'),
})

/**
 * Schema for a comment object returned by tools
 */
const CommentSchema = z.object({
    id: z.string().describe('The unique ID of the comment.'),
    taskId: z.string().optional().describe('The ID of the task this comment belongs to.'),
    projectId: z.string().optional().describe('The ID of the project this comment belongs to.'),
    content: z.string().describe('The content of the comment.'),
    postedAt: z.string().describe('When the comment was posted (ISO 8601 format).'),
    postedUid: z.string().optional().describe('The UID of the user who posted this comment.'),
    fileAttachment: AttachmentSchema.optional().describe('File attachment information, if any.'),
})

/**
 * Schema for an activity event object returned by tools
 */
const ActivityEventSchema = z.object({
    id: z.string().optional().describe('The unique ID of the activity event.'),
    objectType: z
        .string()
        .describe('The type of object this event relates to (task, project, etc).'),
    objectId: z.string().describe('The ID of the object this event relates to.'),
    eventType: z.string().describe('The type of event (added, updated, deleted, completed, etc).'),
    eventDate: z.string().describe('When the event occurred (ISO 8601 format).'),
    parentProjectId: z.string().optional().describe('The ID of the parent project.'),
    parentItemId: z.string().optional().describe('The ID of the parent item.'),
    initiatorId: z.string().optional().describe('The ID of the user who initiated this event.'),
    extraData: z.record(z.string(), z.unknown()).optional().describe('Additional event data.'),
})

/**
 * Schema for a user/collaborator object returned by tools
 */
const CollaboratorSchema = z.object({
    id: z.string().describe('The unique ID of the user.'),
    name: z.string().describe('The full name of the user.'),
    email: z.string().describe('The email address of the user.'),
})

/**
 * Schema for a label object returned by tools
 */
const LabelSchema = z.object({
    id: z.string().describe('The unique ID of the label.'),
    name: z.string().describe('The name of the label.'),
    color: ColorOutputSchema,
    order: z.number().optional().catch(undefined).describe('The display order of the label.'),
    isFavorite: z.boolean().describe('Whether the label is marked as favorite.'),
})

/**
 * Schema for a reminder due date
 */
const ReminderDueSchema = z.object({
    isRecurring: z.boolean().describe('Whether this is a recurring reminder.'),
    string: z.string().describe('Human-readable due string.'),
    date: z.string().describe('Due date in ISO format.'),
    datetime: z.string().optional().describe('Due datetime in ISO format.'),
    timezone: z.string().optional().describe('Timezone of the reminder.'),
})

/**
 * Schema for a mapped reminder object returned by tools
 */
const ReminderSchema = z.object({
    id: z.string().describe('The unique ID of the reminder.'),
    taskId: z.string().describe('The task ID this reminder belongs to.'),
    type: z.enum(REMINDER_TYPES).describe('The type of reminder: relative, absolute, or location.'),
    minuteOffset: z
        .number()
        .optional()
        .describe('Minutes before due time to trigger (relative reminders only).'),
    due: ReminderDueSchema.optional().describe(
        'Due date info (absolute and sometimes relative reminders).',
    ),
    name: z.string().optional().describe('Location name (location reminders only).'),
    locLat: z.string().optional().describe('Latitude (location reminders only).'),
    locLong: z.string().optional().describe('Longitude (location reminders only).'),
    locTrigger: z
        .enum(LOCATION_TRIGGERS)
        .optional()
        .describe('Trigger type: on_enter or on_leave (location reminders only).'),
    radius: z.number().optional().describe('Geofence radius in meters (location reminders only).'),
    isUrgent: z
        .boolean()
        .optional()
        .describe('Whether this is an urgent reminder (relative and absolute reminders only).'),
})

/**
 * Schema for a goal object returned by tools
 */
const GoalSchema = z.object({
    id: z.string().describe('The unique ID of the goal.'),
    name: z.string().describe('The name of the goal.'),
    ownerType: z.string().describe('The owner type: USER or WORKSPACE.'),
    ownerId: z.string().describe('The owner ID (user ID or workspace ID).'),
    description: z.string().optional().describe('The description of the goal.'),
    deadline: z.string().optional().describe('The deadline (YYYY-MM-DD).'),
    responsibleUid: z.string().optional().describe('The user ID responsible for this goal.'),
    isCompleted: z.boolean().describe('Whether the goal is completed.'),
    progress: z
        .object({
            totalTaskCount: z.number(),
            completedTaskCount: z.number(),
            percentage: z.number(),
        })
        .optional()
        .describe('Progress of linked tasks.'),
})

/**
 * Schema for batch operation failure
 */
const FailureSchema = z.object({
    item: z.string().describe('The item that failed (usually an ID or identifier).'),
    error: z.string().describe('The error message.'),
    code: z.string().optional().describe('The error code, if available.'),
})

export {
    ActivityEventSchema,
    CollaboratorSchema,
    CommentSchema,
    FailureSchema,
    GoalSchema,
    LabelSchema,
    ProjectSchema,
    ReminderSchema,
    SectionSchema,
    type SectionSummary,
    TaskSchema,
    toSectionSummary,
}
