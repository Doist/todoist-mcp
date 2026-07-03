import type {
    CurrentUser,
    Label,
    PersonalProject,
    Section,
    Task,
    WorkspaceProject,
} from '@doist/todoist-sdk'
import { type MappedTask } from '../tool-helpers'
import { convertPriorityToNumber, type Priority } from './priorities'

type TaskWithUserFacingPriority = Omit<Task, 'priority'> & {
    priority: Priority
}

/**
 * Creates a mock Task with all required properties and sensible defaults.
 * Pass only the properties you want to override for your specific test.
 */
export function createMockTask({
    priority = 'p4',
    ...overrides
}: Partial<TaskWithUserFacingPriority> = {}): Task {
    return {
        id: '8485093748',
        content: 'Test task content',
        description: '',
        completedAt: null,
        labels: [],
        childOrder: 1,
        projectId: '6cfCcrrCFg2xP94Q',
        sectionId: null,
        parentId: null,
        url: 'https://todoist.com/showTask?id=8485093748',
        addedByUid: '713437',
        addedAt: new Date('2025-08-13T22:09:56.123456Z'),
        deadline: null,
        responsibleUid: null,
        assignedByUid: null,
        isCollapsed: false,
        isDeleted: false,
        duration: null,
        checked: false,
        updatedAt: new Date('2025-08-13T22:09:56.123456Z'),
        due: null,
        dayOrder: 0,
        userId: '713437',
        priority: convertPriorityToNumber(priority),
        isUncompletable: false,
        ...overrides,
    }
}

/**
 * Creates a mock Section with all required properties and sensible defaults.
 * Pass only the properties you want to override for your specific test.
 */
export function createMockSection(overrides: Partial<Section> = {}): Section {
    return {
        id: 'section-123',
        projectId: '6cfCcrrCFg2xP94Q',
        sectionOrder: 1,
        userId: 'test-user',
        addedAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        archivedAt: null,
        isArchived: false,
        isDeleted: false,
        isCollapsed: false,
        name: 'Test Section',
        description: null,
        url: 'https://todoist.com/sections/section-123',
        ...overrides,
    }
}

/**
 * Creates a mock PersonalProject with all required properties and sensible defaults.
 * Pass only the properties you want to override for your specific test.
 */
export function createMockProject(overrides: Partial<PersonalProject> = {}): PersonalProject {
    return {
        id: '6cfCcrrCFg2xP94Q',
        name: 'Test Project',
        color: 'charcoal',
        isFavorite: false,
        isShared: false,
        parentId: null,
        inboxProject: false,
        viewStyle: 'list',
        url: 'https://todoist.com/projects/6cfCcrrCFg2xP94Q',
        isDeleted: false,
        updatedAt: new Date('2025-08-13T22:09:55.841800Z'),
        createdAt: new Date('2025-08-13T22:09:55.841785Z'),
        childOrder: 1,
        defaultOrder: 0,
        description: '',
        isCollapsed: false,
        canAssignTasks: false,
        isFrozen: false,
        isArchived: false,
        ...overrides,
    }
}

/**
 * Creates a mock WorkspaceProject with all required properties and sensible defaults.
 * Pass only the properties you want to override for your specific test.
 */
export function createMockWorkspaceProject(
    overrides: Partial<WorkspaceProject> = {},
): WorkspaceProject {
    return {
        id: TEST_IDS.PROJECT_WORKSPACE,
        name: 'Workspace Project',
        color: 'blue',
        isFavorite: false,
        isShared: true,
        viewStyle: 'list',
        url: 'https://todoist.com/projects/workspace-project-id',
        isDeleted: false,
        updatedAt: new Date('2025-08-13T22:09:55.841800Z'),
        createdAt: new Date('2025-08-13T22:09:55.841785Z'),
        childOrder: 1,
        defaultOrder: 0,
        description: '',
        isCollapsed: false,
        canAssignTasks: true,
        isFrozen: false,
        isArchived: false,
        workspaceId: TEST_IDS.WORKSPACE_1,
        folderId: null,
        collaboratorRoleDefault: 'member',
        role: 'admin',
        status: 'active',
        isInviteOnly: false,
        isLinkSharingEnabled: true,
        ...overrides,
    }
}

/**
 * Creates a mock Label with all required properties and sensible defaults.
 * Pass only the properties you want to override for your specific test.
 */
export function createMockLabel(overrides: Partial<Label> = {}): Label {
    return {
        id: 'label-123',
        name: 'Test Label',
        color: 'red',
        order: 1,
        isFavorite: false,
        ...overrides,
    }
}

/**
 * Creates a mock API response object with results and nextCursor.
 */
export function createMockApiResponse<T>(
    results: T[],
    nextCursor: string | null = null,
): {
    results: T[]
    nextCursor: string | null
} {
    return {
        results,
        nextCursor,
    }
}

/**
 * Creates a simplified mapped task (matches mapTask output) for filter-based query tests.
 */
export function createMappedTask(overrides: Partial<MappedTask> = {}): MappedTask {
    return {
        id: TEST_IDS.TASK_1,
        content: 'Test task content',
        description: '',
        dueDate: undefined,
        recurring: false,
        deadlineDate: undefined,
        priority: 'p4',
        projectId: TEST_IDS.PROJECT_TEST,
        sectionId: undefined,
        parentId: undefined,
        labels: [],
        duration: undefined,
        responsibleUid: undefined,
        assignedByUid: undefined,
        checked: false,
        completedAt: undefined,
        ...overrides,
    }
}

/**
 * Common error messages used across tests.
 */
export const TEST_ERRORS = {
    API_RATE_LIMIT: 'API Error: Rate limit exceeded',
    API_UNAUTHORIZED: 'API Error: Unauthorized',
    INVALID_CURSOR: 'Invalid cursor format',
    INVALID_FILTER: 'Invalid filter query',
} as const

/**
 * Creates multiple test cases for parameterized testing.
 */
export function createTestCases<T, E = unknown>(
    cases: Array<{ name: string; input: T; expected?: E }>,
) {
    return cases
}

/**
 * Common mock IDs used across tests for consistency.
 */
export const TEST_IDS = {
    TASK_1: '8485093748',
    TASK_2: '8485093749',
    TASK_3: '8485093750',
    PROJECT_INBOX: 'inbox-project-id',
    PROJECT_WORK: 'work-project-id',
    PROJECT_TEST: '6cfCcrrCFg2xP94Q',
    PROJECT_WORKSPACE: 'workspace-project-id',
    SECTION_1: 'section-123',
    SECTION_2: 'section-456',
    USER_ID: '713437',
    WORKSPACE_1: 'workspace-123',
} as const

/**
 * Fixed date for consistent test snapshots.
 * Use this instead of new Date() in tests to avoid snapshot drift.
 */
export const TODAY = '2025-08-17' as const

/**
 * Creates a mock CurrentUser with all required properties and sensible defaults.
 * Pass only the properties you want to override for your specific test.
 */
export function createMockUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
    return {
        id: TEST_IDS.USER_ID,
        email: 'test@example.com',
        fullName: 'Test User',
        businessAccountId: null,
        isPremium: false,
        premiumStatus: 'not_premium',
        dateFormat: 0,
        timeFormat: 0,
        weeklyGoal: 5,
        dailyGoal: 5,
        completedCount: 0,
        completedToday: 0,
        daysOff: [],
        inboxProjectId: TEST_IDS.PROJECT_INBOX,
        karma: 0,
        karmaTrend: 'up' as const,
        lang: 'en',
        nextWeek: 1,
        startDay: 1,
        startPage: 'today',
        weekendStartDay: 6,
        tzInfo: {
            timezone: 'UTC',
            gmtString: '+00:00',
            hours: 0,
            minutes: 0,
            isDst: 0,
        },
        avatarBig: null,
        avatarMedium: null,
        avatarS640: null,
        avatarSmall: null,
        ...overrides,
    }
}
