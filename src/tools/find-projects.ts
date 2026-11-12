import type { Project, TodoistApi, WorkspaceProjectSummary } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import {
    compileWildcardQuery,
    fetchAllActiveProjects,
    fetchAllArchivedProjects,
    fetchUnjoinedWorkspaceProjects,
    mapProject,
    searchAllProjects,
} from '../tool-helpers.js'
import { ApiLimits } from '../utils/constants.js'
import { ProjectSchema as ProjectOutputSchema } from '../utils/output-schemas.js'
import { formatProjectPreview, summarizeList } from '../utils/response-builders.js'
import { ToolNames } from '../utils/tool-names.js'

const { ADD_PROJECTS, PROJECT_MANAGEMENT } = ToolNames

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
    includeUnjoined: z
        .boolean()
        .optional()
        .describe(
            `Also list workspace projects the user can join but hasn't, in unjoinedProjects (first page only). They can't be read until joined; join with ${PROJECT_MANAGEMENT} (action 'join') only when the user asks.`,
        ),
}

const UnjoinedProjectSchema = z.object({
    id: z.string(),
    name: z.string(),
    workspaceId: z.string(),
    url: z.string(),
})

const OutputSchema = {
    projects: z.array(ProjectOutputSchema).describe('The found projects.'),
    nextCursor: z.string().optional(),
    totalCount: z.number().describe('The total number of projects in this page.'),
    hasMore: z.boolean(),
    appliedFilters: z.record(z.string(), z.unknown()),
    unjoinedProjects: z
        .array(UnjoinedProjectSchema)
        .optional()
        .describe('Up to limit. With includeUnjoined, or when a search matched no joined project.'),
    unjoinedHasMore: z
        .boolean()
        .optional()
        .describe('More matched than limit; narrow with searchText.'),
}

const findProjects = {
    name: ToolNames.FIND_PROJECTS,
    description:
        "List or search by name the projects the user has joined. By default only active projects are returned; use archivedStatus ('archived' or 'all') to include archived projects. When searching or when archivedStatus is 'all', all matching projects are returned (pagination is ignored). Otherwise projects are returned with pagination. Workspace projects the user hasn't joined are left out unless includeUnjoined is set, or a search matches no joined project.",
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
        const unjoined = await findUnjoinedProjects(client, args, projects.length)

        return {
            textContent: generateTextContent({ projects, args, nextCursor, unjoined }),
            structuredContent: {
                projects,
                nextCursor: nextCursor ?? undefined,
                totalCount: projects.length,
                hasMore: Boolean(nextCursor),
                appliedFilters: args,
                unjoinedProjects: unjoined?.listed.map(toUnjoinedProject),
                unjoinedHasMore: unjoined ? unjoined.total > unjoined.listed.length : undefined,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

type FindProjectsArgs = z.infer<z.ZodObject<typeof ArgsSchema>>

/** The unjoined workspace projects to show, capped at `limit`, out of `total` matches. */
type UnjoinedMatches = { listed: WorkspaceProjectSummary[]; total: number }

/**
 * Unjoined workspace projects are listed alongside the first page only, and
 * never for archived projects, which can't be joined from here. Searches and
 * `archivedStatus: 'all'` return every match at once and ignore the cursor.
 */
function canListUnjoined({ cursor, searchText, archivedStatus }: FindProjectsArgs): boolean {
    if (archivedStatus === 'archived') {
        return false
    }
    const paginated = !searchText && archivedStatus !== 'all'
    return !(paginated && cursor)
}

/**
 * Lists unjoined workspace projects when asked to, or when a search found
 * nothing among the user's own projects, since the project they are after may
 * be one they haven't joined.
 */
async function findUnjoinedProjects(
    client: TodoistApi,
    args: FindProjectsArgs,
    joinedMatches: number,
): Promise<UnjoinedMatches | undefined> {
    const { includeUnjoined, searchText, limit } = args
    const emptySearch = Boolean(searchText) && joinedMatches === 0
    if (!canListUnjoined(args) || !(includeUnjoined || emptySearch)) {
        return undefined
    }

    let unjoined: WorkspaceProjectSummary[]
    try {
        unjoined = await fetchUnjoinedWorkspaceProjects(client)
    } catch (error) {
        // Asked for explicitly, a failure must not pass for "there are none".
        // As a fallback for an empty search, the search result still stands.
        if (includeUnjoined) throw error
        return undefined
    }

    const wildcard = searchText ? compileWildcardQuery(searchText) : null
    const matches = wildcard ? unjoined.filter((project) => wildcard.test(project.name)) : unjoined
    return { listed: matches.slice(0, limit), total: matches.length }
}

function toUnjoinedProject({ id, name, workspaceId, url }: WorkspaceProjectSummary) {
    return { id, name, workspaceId, url }
}

function generateTextContent({
    projects,
    args,
    nextCursor,
    unjoined,
}: {
    projects: ReturnType<typeof mapProject>[]
    args: FindProjectsArgs
    nextCursor: string | null
    unjoined: UnjoinedMatches | undefined
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
        if (args.searchText && unjoined?.total) {
            // The matches are listed below, among the projects the user hasn't joined.
            zeroReasonHints.push('None of the projects the user has joined match')
        } else if (args.searchText) {
            if (unjoined) {
                zeroReasonHints.push("No workspace project the user hasn't joined matches either")
            } else if (canListUnjoined(args)) {
                // The fallback lookup failed. Asking for it explicitly reports why.
                zeroReasonHints.push(
                    "Set includeUnjoined to also search workspace projects the user hasn't joined",
                )
            }
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

    const summary = summarizeList({
        subject,
        count: projects.length,
        limit: args.searchText || args.archivedStatus === 'all' ? undefined : args.limit,
        nextCursor: nextCursor ?? undefined,
        filterHints,
        previewLines: previewWithMore,
        zeroReasonHints,
    })

    if (!unjoined?.total) {
        return summary
    }

    const unjoinedLines = unjoined.listed
        .slice(0, previewLimit)
        .map(
            (project) =>
                `    ${project.name} • id=${project.id} • workspaceId=${project.workspaceId}`,
        )
    const moreUnjoined = unjoined.total - unjoinedLines.length
    if (moreUnjoined > 0) {
        unjoinedLines.push(`    …and ${moreUnjoined} more; narrow with searchText`)
    }
    return [
        summary,
        `Workspace projects the user hasn't joined (${unjoined.total}):`,
        ...unjoinedLines,
        `Their tasks, comments and activity can't be read until the user joins. Ask the user before joining one with ${PROJECT_MANAGEMENT} (action: "join").`,
    ].join('\n')
}

export { findProjects }
