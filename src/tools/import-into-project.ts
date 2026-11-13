import type { ImportTemplateResponse } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapComment, mapTask } from '../tool-helpers.js'
import {
    CommentSchema,
    SectionSchema,
    TaskSchema,
    toSectionSummary,
} from '../utils/output-schemas.js'
import { extractTemplateId } from '../utils/template-ids.js'
import { ToolNames } from '../utils/tool-names.js'

const ArgsSchema = {
    projectId: z.string().min(1).describe('The ID of the existing project to import into.'),
    templateId: z
        .string()
        .min(1)
        .optional()
        .describe(
            'The template to import — either a gallery slug ("product-launch"), a personal template ID ("UT_28Ex..."), or a full Todoist template URL, which is reduced to the ID automatically. Gallery templates work for anyone; personal templates only for the account that owns them. There is no way to list templates through this server, so only use the ID or URL the user supplied. Not with `csvFileContent`.',
        ),
    csvFileContent: z
        .string()
        .min(1)
        .optional()
        .describe(
            'CSV content to import, e.g. from export-project-as-csv or a file the user shared. Not with `templateId`.',
        ),
    locale: z.string().optional().describe('Locale for a template\'s content. Defaults to "en".'),
}

// The API also returns a `projects` array, but it stays empty when importing into an
// existing project — the create-project-from-file endpoint is what populates it. Its
// count still feeds totalCount so nothing goes unreported.
const OutputSchema = {
    sections: z.array(SectionSchema).describe('Sections created by the import.'),
    tasks: z.array(TaskSchema).describe('Tasks created by the import.'),
    comments: z.array(CommentSchema).describe('Comments created by the import.'),
    totalCount: z.number().describe('The total number of objects created by the import.'),
}

/** The tool result for an import into a project, from a template (`source`) or a CSV. */
function toProjectImportResult({
    projectId,
    source,
    result,
}: {
    projectId: string
    source: 'template' | 'CSV'
    result: ImportTemplateResponse
}) {
    const sections = result.sections.map(toSectionSummary)
    const tasks = result.tasks.map(mapTask)
    const comments = result.comments.map(mapComment)
    const totalCount = result.projects.length + sections.length + tasks.length + comments.length

    return {
        textContent: generateTextContent({
            projectId,
            source,
            counts: {
                projects: result.projects.length,
                sections: sections.length,
                tasks: tasks.length,
                comments: comments.length,
            },
            totalCount,
        }),
        structuredContent: { sections, tasks, comments, totalCount },
    }
}

function generateTextContent({
    projectId,
    source,
    counts,
    totalCount,
}: {
    projectId: string
    source: 'template' | 'CSV'
    counts: { projects: number; sections: number; tasks: number; comments: number }
    totalCount: number
}) {
    if (totalCount === 0) {
        return `Imported ${source} into project (id=${projectId}), but it created nothing.`
    }

    const parts = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${count === 1 ? kind.replace(/s$/, '') : kind}`)

    return `Imported ${source} into project (id=${projectId}): ${parts.join(', ')}.`
}

const importIntoProject = {
    name: ToolNames.IMPORT_INTO_PROJECT,
    description:
        'Import a template (by ID or URL) or CSV content into an existing project, like the app\'s "Import from CSV", adding its tasks, sections and comments to whatever is already there. To start a new project from a template, create the project with add-projects first, then import into it. This writes immediately and cannot be undone, so only run it against a project the user named.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ projectId, templateId, csvFileContent, locale }, client) {
        if (Boolean(templateId) === Boolean(csvFileContent)) {
            throw new Error(
                'Provide exactly one source: either `templateId` or `csvFileContent`. Templates cannot be listed through this server — ask the user for an ID or template URL.',
            )
        }

        const result = templateId
            ? await client.importTemplateFromId({
                  projectId,
                  templateId: extractTemplateId(templateId),
                  locale,
              })
            : await client.importCSVIntoProject({
                  projectId,
                  // The SDK treats strings as filesystem paths, not file content.
                  file: new Blob([csvFileContent ?? ''], { type: 'text/csv' }),
                  fileName: 'template.csv',
              })

        return toProjectImportResult({ projectId, source: templateId ? 'template' : 'CSV', result })
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

export { importIntoProject }
