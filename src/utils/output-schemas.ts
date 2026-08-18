import { LOCATION_TRIGGERS, REMINDER_TYPES, type Section } from '@doist/todoist-sdk'
import { z } from 'zod'
import { ColorOutputSchema } from './colors.js'
import { PrioritySchema } from './priorities.js'

/**
 * Schema for a mapped task object returned by tools
 */
const TaskSchema = z.object({
    id: z.string(),
    content: z.string().describe('Task title.'),
    description: z.string(),
    dueDate: z.string().optional().describe('ISO 8601.'),
    recurring: z
        .union([z.boolean(), z.string()])
        .describe('False when not recurring, otherwise the recurrence string.'),
    deadlineDate: z.string().optional().describe('ISO 8601.'),
    priority: PrioritySchema.describe('p1 is highest, p4 lowest.'),
    projectId: z.string(),
    sectionId: z.string().optional(),
    parentId: z.string().optional(),
    labels: z.array(z.string()).optional(),
    duration: z.string().optional().describe('e.g. "2h30m".'),
    responsibleUid: z.string().optional(),
    isUncompletable: z.boolean().optional().describe('An organizational header, not a real task.'),
    assignedByUid: z.string().optional(),
    checked: z.boolean().describe('Whether the task is completed.'),
    completedAt: z.string().optional().describe('ISO 8601.'),
    addedAt: z.string().optional().describe('ISO 8601.'),
})

/**
 * Schema for a mapped project object returned by tools
 */
const ProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().describe('Empty string when none.'),
    color: ColorOutputSchema,
    isFavorite: z.boolean(),
    isShared: z.boolean(),
    parentId: z.string().optional(),
    inboxProject: z.boolean(),
    viewStyle: z.string().describe('list, board or calendar.'),
    workspaceId: z.string().optional().describe('Undefined for personal projects.'),
    folderId: z.string().optional().describe('Workspace projects only.'),
    childOrder: z.number().describe('Ordering index among siblings.'),
    isArchived: z.boolean(),
})

/**
 * Schema for a section object returned by tools
 */
const SectionSchema = z.object({
    id: z.string(),
    name: z.string(),
    sectionOrder: z.number().describe('Ordering index within the project.'),
    description: z.string().optional().describe('Supports Markdown.'),
})

type SectionSummary = z.infer<typeof SectionSchema>

/**
 * Strip an SDK Section down to the fields declared in SectionSchema. Keeps tool
 * responses aligned with the schema. The output schema uses an optional string
 * (Gemini-compatible), so the read's `string | null` description maps `null` to
 * `undefined`.
 */
function toSectionSummary({ id, name, sectionOrder, description }: Section): SectionSummary {
    return { id, name, sectionOrder, description: description ?? undefined }
}

/**
 * Schema for a file attachment in a comment
 */
const AttachmentSchema = z.object({
    resourceType: z.string().describe('file, url, image, etc.'),
    fileName: z.string().optional(),
    fileSize: z.number().optional().describe('Bytes.'),
    fileType: z.string().optional().describe('MIME type.'),
    fileUrl: z.string().optional(),
    fileDuration: z.number().optional().describe('Milliseconds, for audio/video.'),
    uploadState: z.enum(['pending', 'completed']).optional(),
    url: z.string().optional().describe('For link/url resource types.'),
    title: z.string().optional().describe('For link/url resource types.'),
    image: z.string().optional().describe('For image resource types.'),
    imageWidth: z.number().optional().describe('Pixels.'),
    imageHeight: z.number().optional().describe('Pixels.'),
})

/**
 * Schema for a comment object returned by tools
 */
const CommentSchema = z.object({
    id: z.string(),
    taskId: z.string().optional(),
    projectId: z.string().optional(),
    content: z.string(),
    postedAt: z.string().describe('ISO 8601.'),
    postedUid: z.string().optional(),
    notifiedUserIds: z
        .array(z.string())
        .optional()
        .describe('Users notified about this comment. Absent when nobody was notified.'),
    fileAttachment: AttachmentSchema.optional(),
})

/**
 * Schema for an activity event object returned by tools
 */
const ActivityEventSchema = z.object({
    id: z.string().optional(),
    objectType: z.string().describe('task, project, etc.'),
    objectId: z.string(),
    eventType: z.string().describe('added, updated, deleted, completed, etc.'),
    eventDate: z.string().describe('ISO 8601.'),
    parentProjectId: z.string().optional(),
    parentItemId: z.string().optional(),
    initiatorId: z.string().optional().describe('User who initiated the event.'),
    extraData: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Schema for a user/collaborator object returned by tools
 */
const CollaboratorSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
})

/**
 * Schema for a label object returned by tools
 */
const LabelSchema = z.object({
    id: z.string(),
    name: z.string(),
    color: ColorOutputSchema,
    order: z.number().optional().catch(undefined).describe('Display order.'),
    isFavorite: z.boolean(),
})

/**
 * Schema for a reminder due date
 */
const ReminderDueSchema = z.object({
    isRecurring: z.boolean(),
    string: z.string().describe('Human-readable due string.'),
    date: z.string().describe('ISO 8601.'),
    datetime: z.string().optional().describe('ISO 8601.'),
    timezone: z.string().optional(),
})

/**
 * Schema for a mapped reminder object returned by tools
 */
const ReminderSchema = z.object({
    id: z.string(),
    taskId: z.string(),
    type: z.enum(REMINDER_TYPES),
    minuteOffset: z.number().optional().describe('Minutes before due. Relative reminders only.'),
    due: ReminderDueSchema.optional().describe('Absolute, and sometimes relative, reminders.'),
    name: z.string().optional().describe('Location name. Location reminders only.'),
    locLat: z.string().optional().describe('Location reminders only.'),
    locLong: z.string().optional().describe('Location reminders only.'),
    locTrigger: z.enum(LOCATION_TRIGGERS).optional().describe('Location reminders only.'),
    radius: z.number().optional().describe('Geofence radius in metres. Location reminders only.'),
    isUrgent: z.boolean().optional().describe('Relative and absolute reminders only.'),
})

/**
 * Schema for batch operation failure
 */
const FailureSchema = z.object({
    item: z.string().describe('Usually the ID of the item that failed.'),
    error: z.string(),
    code: z.string().optional(),
})

export {
    ActivityEventSchema,
    CollaboratorSchema,
    CommentSchema,
    FailureSchema,
    LabelSchema,
    ProjectSchema,
    ReminderSchema,
    SectionSchema,
    type SectionSummary,
    TaskSchema,
    toSectionSummary,
}
