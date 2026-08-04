import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapComment, mapProject, mapTask } from '../tool-helpers.js'
import {
    CommentSchema,
    ProjectSchema,
    SectionSchema,
    TaskSchema,
    toSectionSummary,
} from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'

/**
 * Accepts a bare template ID or any Todoist template URL. Both gallery links
 * (`/templates/product-launch`) and in-app links
 * (`/app/templates/category/my-templates/UT_28Ex.../view`) reduce to the last
 * path segment once a trailing `/view` is dropped.
 */
function extractTemplateId(input: string): string {
    const trimmed = input.trim()

    if (!/^https?:\/\//i.test(trimmed)) {
        return trimmed
    }

    const segments = trimmed
        .replace(/[?#].*$/, '')
        .split('/')
        .filter((segment) => segment.length > 0)
    const last = segments.at(-1)

    return (last === 'view' ? segments.at(-2) : last) ?? trimmed
}

const ArgsSchema = {
    projectId: z
        .string()
        .min(1)
        .describe('The ID of the existing project to import the template into.'),
    templateId: z
        .string()
        .optional()
        .describe(
            'The template to import — either a gallery slug ("product-launch"), a personal template ID ("UT_28Ex..."), or a full Todoist template URL, which is reduced to the ID automatically. Gallery templates work for anyone; personal templates only for the account that owns them. There is no way to list templates through this server, so only use an ID or URL the user supplied. Provide either this or `file`, not both.',
        ),
    file: z
        .string()
        .optional()
        .describe(
            'Raw CSV template content, as produced by export-template. Provide either this or `templateId`, not both.',
        ),
    locale: z
        .string()
        .optional()
        .describe('Locale for the imported content when using `templateId`. Defaults to "en".'),
}

const OutputSchema = {
    projects: z.array(ProjectSchema).describe('Projects created by the import.'),
    sections: z.array(SectionSchema).describe('Sections created by the import.'),
    tasks: z.array(TaskSchema).describe('Tasks created by the import.'),
    comments: z.array(CommentSchema).describe('Comments created by the import.'),
    totalCount: z.number().describe('The total number of objects created by the import.'),
}

const importTemplate = {
    name: ToolNames.IMPORT_TEMPLATE,
    // Additive rather than destructive, but there is no dry run and no undo: a wrong ID
    // silently fills a real project. Require an explicit projectId; never infer one.
    description:
        'Import a template into an existing project, adding its tasks, sections and comments to whatever is already there. Source it by template ID/URL or by passing CSV content from export-template. To start a new project from a template, create the project with add-projects first, then import into it. This writes immediately and cannot be undone, so only run it against a project the user named.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ projectId, templateId, file, locale }, client) {
        if (Boolean(templateId) === Boolean(file)) {
            throw new Error(
                'Provide exactly one template source: either `templateId` or `file`. Templates cannot be listed through this server — ask the user for an ID or template URL.',
            )
        }

        const result = templateId
            ? await client.importTemplateFromId({
                  projectId,
                  templateId: extractTemplateId(templateId),
                  locale,
              })
            : await client.importTemplateIntoProject({
                  projectId,
                  file: file ?? '',
                  fileName: 'template.csv',
              })

        const projects = result.projects.map(mapProject)
        const sections = result.sections.map(toSectionSummary)
        const tasks = result.tasks.map(mapTask)
        const comments = result.comments.map(mapComment)
        const totalCount = projects.length + sections.length + tasks.length + comments.length

        return {
            textContent: generateTextContent({
                projectId,
                counts: {
                    projects: projects.length,
                    sections: sections.length,
                    tasks: tasks.length,
                    comments: comments.length,
                },
                totalCount,
            }),
            structuredContent: { projects, sections, tasks, comments, totalCount },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    projectId,
    counts,
    totalCount,
}: {
    projectId: string
    counts: { projects: number; sections: number; tasks: number; comments: number }
    totalCount: number
}) {
    if (totalCount === 0) {
        return `Imported template into project (id=${projectId}), but it created nothing.`
    }

    const parts = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${count === 1 ? kind.replace(/s$/, '') : kind}`)

    return `Imported template into project (id=${projectId}): ${parts.join(', ')}.`
}

export { extractTemplateId, importTemplate }
