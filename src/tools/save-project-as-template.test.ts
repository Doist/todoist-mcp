import type { Template, TodoistApi } from '@doist/todoist-sdk'
import { type Mocked, vi } from 'vitest'
import { createMockProject } from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { saveProjectAsTemplate } from './save-project-as-template.js'

const mockTodoistApi = {
    createUserTemplate: vi.fn(),
    getProject: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { SAVE_PROJECT_AS_TEMPLATE } = ToolNames

function createTemplate(overrides: Partial<Template> = {}): Template {
    return {
        id: 'UT_28Ex1',
        name: 'Launch plan',
        templateType: 'project',
        templateSource: 'user',
        shortDescription: 'Everything for a launch',
        longDescription: 'Everything for a launch',
        instructions: null,
        thumbnailImage: null,
        thumbnailImageDark: null,
        coverImage: null,
        previewImage: null,
        templateColor: 'blue',
        backgroundColor: null,
        backgroundColorDark: null,
        creator: { userId: '1', name: 'Ada', position: '', avatar: '' },
        seo: null,
        moreResources: [],
        categoryIds: [],
        workspaceId: null,
        sharedWithWorkspaceMembers: false,
        ...overrides,
    }
}

describe(`${SAVE_PROJECT_AS_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.createUserTemplate.mockResolvedValue(createTemplate())
        mockTodoistApi.getProject.mockResolvedValue(
            createMockProject({ id: 'project-1', color: 'berry_red' }),
        )
    })

    it('saves a personal template in the given color without reading the project', async () => {
        const result = await saveProjectAsTemplate.execute(
            {
                projectId: 'project-1',
                name: 'Launch plan',
                description: 'Everything for a launch',
                color: 'blue',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProject).not.toHaveBeenCalled()
        expect(mockTodoistApi.createUserTemplate).toHaveBeenCalledWith({
            projectId: 'project-1',
            name: 'Launch plan',
            description: 'Everything for a launch',
            color: 'blue',
            forWorkspace: undefined,
        })
        expect(result.structuredContent).toEqual({ templateId: 'UT_28Ex1', name: 'Launch plan' })
        expect(result.textContent).toBe(
            'Saved project (id=project-1) as template "Launch plan" (id=UT_28Ex1). It is in your personal templates. Use create-project-from-template with this ID to start a new project from it.',
        )
    })

    it("defaults the color to the project's color", async () => {
        await saveProjectAsTemplate.execute(
            { projectId: 'project-1', name: 'Launch plan', description: 'A launch' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.getProject).toHaveBeenCalledWith('project-1')
        expect(mockTodoistApi.createUserTemplate).toHaveBeenCalledWith(
            expect.objectContaining({ color: 'berry_red' }),
        )
    })

    it('saves to the workspace and says it is not shared yet', async () => {
        mockTodoistApi.createUserTemplate.mockResolvedValue(createTemplate({ workspaceId: '111' }))

        const result = await saveProjectAsTemplate.execute(
            {
                projectId: 'project-1',
                name: 'Launch plan',
                description: 'A launch',
                color: 'blue',
                saveToWorkspace: true,
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.createUserTemplate).toHaveBeenCalledWith(
            expect.objectContaining({ forWorkspace: true }),
        )
        expect(result.structuredContent).toEqual({
            templateId: 'UT_28Ex1',
            name: 'Launch plan',
            workspaceId: '111',
        })
        expect(result.textContent).toContain(
            "It is in the workspace's templates (workspace id=111), not yet shared with members.",
        )
    })
})
