import type { Project } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import {
    compileWildcardQuery,
    fetchAllActiveProjects,
    fetchAllArchivedProjects,
    mapProject,
    searchAllProjects,
} from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { ProjectSchema as ProjectOutputSchema } from '../utils/output-schemas.js'
import { formatProjectPreview, summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const { ADD_PROJECTS } = ToolNames

const SCOPE_NOUNS = {
    active: 'projects',
    archived: 'archived projects',
    all: 'projects (active and archived)',
} as const

const ArgsSchema = {
    searchText: z
        .string()
        .optional()
        .describe(
            'Search for a project by name (partial and case insensitive match). Supports wildcards (e.g. "work*" for prefix match). Use "\\*" for a literal asterisk. If omitted, all projects are returned.',
        ),
    limit: z
        .number()
        .int()
        .min(1)
        .max(ApiLimits.PROJECTS_MAX)
        .default(ApiLimits.PROJECTS_DEFAULT)
        .describe('The maximum number of projects to return.'),
    cursor: z
        .string()
        .optional()
        .describe(
            'The cursor to get the next page of projects (cursor is obtained from the previous call to this tool, with the same parameters).',
        ),
    archivedStatus: z
        .enum(['active', 'archived', 'all'])
        .optional()
        .describe(
            "Which projects to return by archive status: 'active' (default, non-archived only), 'archived' (archived only), or 'all' (both active and archived). Each project includes an isArchived field. Archived projects can be deleted via the delete-object tool (type: 'project').",
        ),
}

const OutputSchema = {
    projects: z.array(ProjectOutputSchema).describe('The found projects.'),
    nextCursor: z.string().optional().describe('Cursor for the next page of results.'),
    totalCount: z.number().describe('The total number of projects in this page.'),
    hasMore: z.boolean().describe('Whether there are more results available.'),
    appliedFilters: z
        .record(z.string(), z.unknown())
        .describe('The filters that were applied to the search.'),
}

const findProjects = {
    name: ToolNames.FIND_PROJECTS,
    description:
        "List all projects or search for projects by name. By default only active projects are returned; use archivedStatus ('archived' or 'all') to include archived projects. When searching or when archivedStatus is 'all', all matching projects are returned (pagination is ignored). Otherwise projects are returned with pagination.",
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async execute(args, client) {
        const { searchText } = args
        const archivedStatus = args.archivedStatus ?? 'active'
        let results: Project[]
        let nextCursor: string | null = null

        if (searchText || archivedStatus === 'all') {
            // Fetch-all path: cannot cursor-paginate across two sources or while
            // filtering archived projects client-side, so all results are returned.
            const empty = Promise.resolve<Project[]>([])
            const [active, archived] = await Promise.all([
                archivedStatus === 'archived'
                    ? empty
                    : searchText
                      ? searchAllProjects(client, searchText)
                      : fetchAllActiveProjects(client),
                archivedStatus === 'active' ? empty : fetchAllArchivedProjects(client),
            ])

            // Archived projects have no server-side search; filter client-side with
            // a single compiled pattern rather than recompiling per project.
            const wildcard = searchText ? compileWildcardQuery(searchText) : null
            const filteredArchived = wildcard
                ? archived.filter((project) => wildcard.test(project.name))
                : archived

            results = [...active, ...filteredArchived]
        } else {
            // Paginated single-source path
            const response =
                archivedStatus === 'archived'
                    ? await client.getArchivedProjects({
                          limit: args.limit,
                          cursor: args.cursor ?? null,
                      })
                    : await client.getProjects({ limit: args.limit, cursor: args.cursor ?? null })
            results = response.results
            nextCursor = response.nextCursor
        }

        const projects = results.map(mapProject)

        return {
            textContent: generateTextContent({ projects, args, nextCursor }),
            structuredContent: {
                projects,
                nextCursor: nextCursor ?? undefined,
                totalCount: projects.length,
                hasMore: Boolean(nextCursor),
                appliedFilters: args,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({
    projects,
    args,
    nextCursor,
}: {
    projects: ReturnType<typeof mapProject>[]
    args: z.infer<z.ZodObject<typeof ArgsSchema>>
    nextCursor: string | null
}) {
    // Generate subject description
    const scopeNoun = SCOPE_NOUNS[args.archivedStatus ?? 'active']
    const subject = args.searchText
        ? `All ${scopeNoun} matching "${args.searchText}"`
        : `${scopeNoun.charAt(0).toUpperCase()}${scopeNoun.slice(1)}`

    // Generate filter hints
    const filterHints: string[] = []
    if (args.searchText) {
        filterHints.push(`searchText: "${args.searchText}"`)
    }
    if (args.archivedStatus && args.archivedStatus !== 'active') {
        filterHints.push(`archivedStatus: "${args.archivedStatus}"`)
    }

    // Generate project preview lines
    const previewLimit = 10
    const previewProjects = projects.slice(0, previewLimit)
    const previewLines = previewProjects.map(formatProjectPreview).join('\n')
    const remainingCount = projects.length - previewLimit
    const previewWithMore =
        remainingCount > 0 ? `${previewLines}\n    …and ${remainingCount} more` : previewLines

    // Generate helpful suggestions for empty results
    const zeroReasonHints: string[] = []
    if (projects.length === 0) {
        if (args.searchText) {
            zeroReasonHints.push('Try broader search terms')
            zeroReasonHints.push('Check spelling')
            zeroReasonHints.push('Remove searchText to see all projects')
        } else if (args.archivedStatus === 'archived') {
            zeroReasonHints.push('No archived projects')
            zeroReasonHints.push("Use archivedStatus: 'all' to also see active projects")
        } else if (args.archivedStatus === 'all') {
            zeroReasonHints.push('No projects created yet')
            zeroReasonHints.push(`Use ${ADD_PROJECTS} to create a project`)
        } else {
            // Default active-only scope: archived projects (if any) are excluded.
            zeroReasonHints.push('No active projects')
            zeroReasonHints.push("Use archivedStatus: 'all' to include archived projects")
            zeroReasonHints.push(`Use ${ADD_PROJECTS} to create a project`)
        }
    }

    return summarizeList({
        subject,
        count: projects.length,
        limit: args.searchText || args.archivedStatus === 'all' ? undefined : args.limit,
        nextCursor: nextCursor ?? undefined,
        filterHints,
        previewLines: previewWithMore,
        zeroReasonHints,
    })
}

export { findProjects }
