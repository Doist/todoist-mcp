import type { PersonalProject, WorkspaceProject } from '@doist/todoist-sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { mapProject } from '../tool-helpers.js'
import { ColorSchema } from '../utils/colors.js'
import { ProjectSchema as ProjectOutputSchema } from '../utils/output-schemas.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'

const ProjectSchema = z.object({
    name: z.string().min(1).describe('The name of the project.'),
    parentId: z
        .string()
        .optional()
        .describe('The ID of the parent project. If provided, creates this as a sub-project.'),
    isFavorite: z
        .boolean()
        .optional()
        .describe('Whether the project is a favorite. Defaults to false.'),
    viewStyle: z
        .enum(['list', 'board', 'calendar'])
        .optional()
        .describe('The project view style. Defaults to "list".'),
    description: z
        .string()
        .optional()
        .describe('The description of the project. Supports Markdown.'),
    color: ColorSchema,
    workspace: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
            'The workspace to create the project in. Accepts a workspace name or workspace ID. ' +
                'If not provided, creates a personal project. Use list-workspaces to see available workspaces.',
        ),
})

const ArgsSchema = {
    projects: z.array(ProjectSchema).min(1).describe('The array of projects to add.'),
}

const OutputSchema = {
    projects: z.array(ProjectOutputSchema).describe('The created projects.'),
    totalCount: z.number().describe('The total number of projects created.'),
}

const addProjects = {
    name: ToolNames.ADD_PROJECTS,
    description: 'Add one or more new projects.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute({ projects }, client) {
        // Collect unique workspace references and resolve each once
        const uniqueWorkspaceRefs = [
            ...new Set(projects.map((p) => p.workspace).filter(Boolean)),
        ] as string[]

        const resolvedWorkspaces = new Map<string, string>()
        for (const ref of uniqueWorkspaceRefs) {
            const resolved = await workspaceResolver.resolveWorkspace(client, ref)
            resolvedWorkspaces.set(ref, resolved.workspaceId)
        }

        const newProjects = await Promise.all(
            projects.map(({ workspace, ...rest }) => {
                const workspaceId = workspace ? resolvedWorkspaces.get(workspace) : undefined
                // Keep the SDK signature so the rest of the payload stays
                // compile-checked; only `description` escapes the types until
                // the SDK adds it to AddProjectArgs.
                const addArgs: Parameters<typeof client.addProject>[0] & { description?: string } =
                    {
                        ...rest,
                        ...(workspaceId ? { workspaceId } : {}),
                    }
                return client.addProject(addArgs)
            }),
        )
        const textContent = generateTextContent({ projects: newProjects })
        const mappedProjects = newProjects.map(mapProject)

        return {
            textContent,
            structuredContent: {
                projects: mappedProjects,
                totalCount: mappedProjects.length,
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

function generateTextContent({ projects }: { projects: (PersonalProject | WorkspaceProject)[] }) {
    const count = projects.length
    const projectList = projects.map((project) => `• ${project.name} (id=${project.id})`).join('\n')

    const summary = `Added ${count} project${count === 1 ? '' : 's'}:\n${projectList}`

    return summary
}

export { addProjects }
