import type { TodoistApi, Workspace } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import {
    createApiError,
    createMockProject,
    mockPersonalProjectCapacity,
} from '../utils/test-helpers.js'
import { ToolNames } from '../utils/tool-names.js'
import { workspaceResolver } from '../utils/workspace-resolver.js'
import { createProjectFromTemplate } from './create-project-from-template.js'

const mockTodoistApi = {
    createProjectFromTemplateId: vi.fn(),
    getProject: vi.fn(),
    getPersonalProjectCapacity: vi.fn(),
    getWorkspaces: vi.fn(),
} as unknown as Mocked<TodoistApi>

const { CREATE_PROJECT_FROM_TEMPLATE } = ToolNames

const WORKSPACE = {
    id: '111',
    name: 'Engineering',
    plan: 'BUSINESS',
    role: 'ADMIN',
    inviteCode: 'abc123',
    isLinkSharingEnabled: true,
    isGuestAllowed: true,
    limits: { current: null, next: null },
    createdAt: new Date('2024-01-15T10:00:00Z'),
    creatorId: 'user-456',
    properties: {},
} as Workspace

describe(`${CREATE_PROJECT_FROM_TEMPLATE} tool`, () => {
    beforeEach(() => {
        vi.clearAllMocks()
        workspaceResolver.clearCache()
        mockPersonalProjectCapacity(mockTodoistApi, { maxProjects: 5, activeCount: 1 })
        mockTodoistApi.createProjectFromTemplateId.mockResolvedValue({
            status: 'ok',
            projectId: 'new-project',
        })
        mockTodoistApi.getProject.mockResolvedValue(
            createMockProject({ id: 'new-project', name: 'Product Launch' }),
        )
    })

    it('creates a personal project from a template ID and reads back its name', async () => {
        const result = await createProjectFromTemplate.execute(
            { templateId: 'product-launch' },
            mockTodoistApi,
        )

        expect(mockTodoistApi.createProjectFromTemplateId).toHaveBeenCalledWith({
            templateId: 'product-launch',
            name: undefined,
            locale: undefined,
            workspaceId: undefined,
            folderId: undefined,
        })
        expect(result.structuredContent).toEqual({
            projectId: 'new-project',
            projectName: 'Product Launch',
        })
        expect(result.textContent).toBe(
            'Created project "Product Launch" (id=new-project) from template product-launch.',
        )
    })

    it('reduces a template URL to its ID', async () => {
        await createProjectFromTemplate.execute(
            {
                templateId:
                    'https://app.todoist.com/app/templates/category/my-templates/UT_28Ex1/view',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.createProjectFromTemplateId).toHaveBeenCalledWith(
            expect.objectContaining({ templateId: 'UT_28Ex1' }),
        )
    })

    it('resolves the workspace by name and passes the name, folder and locale through', async () => {
        mockTodoistApi.getWorkspaces.mockResolvedValue([WORKSPACE])

        await createProjectFromTemplate.execute(
            {
                templateId: 'UT_28Ex1',
                name: 'Q3 launch',
                workspace: 'Engineering',
                folderId: 'folder-1',
                locale: 'de',
            },
            mockTodoistApi,
        )

        expect(mockTodoistApi.createProjectFromTemplateId).toHaveBeenCalledWith({
            templateId: 'UT_28Ex1',
            name: 'Q3 launch',
            locale: 'de',
            workspaceId: '111',
            folderId: 'folder-1',
        })
        expect(mockTodoistApi.getPersonalProjectCapacity).not.toHaveBeenCalled()
    })

    it('refuses a personal project once the account is at its project limit', async () => {
        mockPersonalProjectCapacity(mockTodoistApi, { maxProjects: 5, activeCount: 5 })

        await expect(
            createProjectFromTemplate.execute({ templateId: 'product-launch' }, mockTodoistApi),
        ).rejects.toThrow('limit of 5 active personal projects. The project was not created.')
        expect(mockTodoistApi.createProjectFromTemplateId).not.toHaveBeenCalled()
    })

    it('rejects a folder without a workspace before calling the API', async () => {
        await expect(
            createProjectFromTemplate.execute(
                { templateId: 'product-launch', folderId: 'folder-1' },
                mockTodoistApi,
            ),
        ).rejects.toThrow('Folders only exist in workspaces')
        expect(mockTodoistApi.createProjectFromTemplateId).not.toHaveBeenCalled()
    })

    it('creates nothing when the workspace cannot be found', async () => {
        mockTodoistApi.getWorkspaces.mockResolvedValue([WORKSPACE])

        await expect(
            createProjectFromTemplate.execute(
                { templateId: 'product-launch', workspace: 'No such workspace' },
                mockTodoistApi,
            ),
        ).rejects.toThrow()
        expect(mockTodoistApi.createProjectFromTemplateId).not.toHaveBeenCalled()
    })

    it('retries the create after a 503', async () => {
        vi.useFakeTimers()
        try {
            mockTodoistApi.createProjectFromTemplateId
                .mockRejectedValueOnce(
                    createApiError({ status: 503, error: 'Service Unavailable' }),
                )
                .mockResolvedValueOnce({ status: 'ok', projectId: 'new-project' })

            const promise = createProjectFromTemplate.execute(
                { templateId: 'product-launch' },
                mockTodoistApi,
            )
            await vi.runAllTimersAsync()
            const result = await promise

            expect(mockTodoistApi.createProjectFromTemplateId).toHaveBeenCalledTimes(2)
            expect(result.structuredContent.projectId).toBe('new-project')
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not retry the create after a 502, since the project may already exist', async () => {
        mockTodoistApi.createProjectFromTemplateId.mockRejectedValue(
            createApiError({ status: 502, error: 'Bad gateway' }),
        )

        await expect(
            createProjectFromTemplate.execute({ templateId: 'product-launch' }, mockTodoistApi),
        ).rejects.toThrow('502')
        expect(mockTodoistApi.createProjectFromTemplateId).toHaveBeenCalledTimes(1)
    })

    it('still reports the new project when it cannot be read back', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        mockTodoistApi.getProject.mockRejectedValue(new Error('boom'))

        const result = await createProjectFromTemplate.execute(
            { templateId: 'product-launch' },
            mockTodoistApi,
        )

        expect(result.structuredContent).toEqual({ projectId: 'new-project' })
        expect(result.textContent).toBe(
            'Created project (id=new-project) from template product-launch.',
        )
    })
})
