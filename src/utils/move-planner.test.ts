import { destinationKey, isMoveRedundant, planMove } from './move-planner.js'
import { createMockTask } from './test-helpers.js'

const PROJECT = 'project-1'
const SECTION = 'section-1'
const PARENT = 'parent-1'

describe('isMoveRedundant', () => {
    describe('a project destination', () => {
        it('is redundant when the task already sits at the project root', () => {
            const task = createMockTask({ projectId: PROJECT, sectionId: null, parentId: null })
            expect(isMoveRedundant(task, { projectId: PROJECT })).toBe(true)
        })

        it('is not redundant for a different project', () => {
            const task = createMockTask({ projectId: 'other', sectionId: null, parentId: null })
            expect(isMoveRedundant(task, { projectId: PROJECT })).toBe(false)
        })

        it('is not redundant when the task is in a section, since the move lifts it out', () => {
            const task = createMockTask({ projectId: PROJECT, sectionId: SECTION, parentId: null })
            expect(isMoveRedundant(task, { projectId: PROJECT })).toBe(false)
        })

        it('is not redundant when the task has a parent, since the move lifts it out', () => {
            const task = createMockTask({ projectId: PROJECT, sectionId: null, parentId: PARENT })
            expect(isMoveRedundant(task, { projectId: PROJECT })).toBe(false)
        })
    })

    describe('a section destination', () => {
        it('is redundant when the task already sits directly in that section', () => {
            const task = createMockTask({ sectionId: SECTION, parentId: null })
            expect(isMoveRedundant(task, { sectionId: SECTION })).toBe(true)
        })

        it('is not redundant for a different section', () => {
            const task = createMockTask({ sectionId: 'other', parentId: null })
            expect(isMoveRedundant(task, { sectionId: SECTION })).toBe(false)
        })

        it('is not redundant when the task has no section', () => {
            const task = createMockTask({ sectionId: null, parentId: null })
            expect(isMoveRedundant(task, { sectionId: SECTION })).toBe(false)
        })

        it('is not redundant when the task has a parent, since the move lifts it out', () => {
            const task = createMockTask({ sectionId: SECTION, parentId: PARENT })
            expect(isMoveRedundant(task, { sectionId: SECTION })).toBe(false)
        })
    })

    describe('a parent destination', () => {
        it('is redundant when the task is already that parent’s subtask', () => {
            const task = createMockTask({ parentId: PARENT })
            expect(isMoveRedundant(task, { parentId: PARENT })).toBe(true)
        })

        it('is not redundant for a different parent', () => {
            const task = createMockTask({ parentId: 'other' })
            expect(isMoveRedundant(task, { parentId: PARENT })).toBe(false)
        })

        it('is not redundant when the task has no parent', () => {
            const task = createMockTask({ parentId: null })
            expect(isMoveRedundant(task, { parentId: PARENT })).toBe(false)
        })

        it('ignores section and project, which a parent move determines anyway', () => {
            const task = createMockTask({
                projectId: 'elsewhere',
                sectionId: SECTION,
                parentId: PARENT,
            })
            expect(isMoveRedundant(task, { parentId: PARENT })).toBe(true)
        })
    })
})

describe('destinationKey', () => {
    it('distinguishes the destination kinds', () => {
        expect(destinationKey({ projectId: 'x' })).not.toBe(destinationKey({ sectionId: 'x' }))
        expect(destinationKey({ sectionId: 'x' })).not.toBe(destinationKey({ parentId: 'x' }))
    })

    it('matches for the same destination', () => {
        expect(destinationKey({ projectId: 'x' })).toBe(destinationKey({ projectId: 'x' }))
    })

    it('differs for different destinations of the same kind', () => {
        expect(destinationKey({ projectId: 'x' })).not.toBe(destinationKey({ projectId: 'y' }))
    })
})

describe('planMove', () => {
    const atProjectRoot = createMockTask({
        projectId: PROJECT,
        sectionId: null,
        parentId: null,
    })

    it('plans no move when no container was requested', () => {
        expect(planMove({ taskId: 't', request: {}, current: atProjectRoot })).toEqual({
            redundantMoveSkipped: false,
        })
    })

    it('plans the requested move when the task is somewhere else', () => {
        expect(
            planMove({ taskId: 't', request: { projectId: 'elsewhere' }, current: atProjectRoot }),
        ).toEqual({ move: { projectId: 'elsewhere' }, redundantMoveSkipped: false })
    })

    it('plans no move when the task is already in the requested project', () => {
        expect(
            planMove({ taskId: 't', request: { projectId: PROJECT }, current: atProjectRoot }),
        ).toEqual({ redundantMoveSkipped: true })
    })

    it('moves anyway when the current state is unknown', () => {
        expect(
            planMove({ taskId: 't', request: { projectId: PROJECT }, current: undefined }),
        ).toEqual({ move: { projectId: PROJECT }, redundantMoveSkipped: false })
    })

    it('resolves an echoed project alongside a real section change to the section move', () => {
        expect(
            planMove({
                taskId: 't',
                request: { projectId: PROJECT, sectionId: SECTION },
                current: atProjectRoot,
            }),
        ).toEqual({ move: { sectionId: SECTION }, redundantMoveSkipped: true })
    })

    it('plans no move when a full echo names the project and section the task is in', () => {
        const inSection = createMockTask({ projectId: PROJECT, sectionId: SECTION, parentId: null })
        expect(
            planMove({
                taskId: 't',
                request: { projectId: PROJECT, sectionId: SECTION },
                current: inSection,
            }),
        ).toEqual({ redundantMoveSkipped: true })
    })

    it('plans no move when a full echo names the section and parent the task is under', () => {
        const subtask = createMockTask({
            projectId: PROJECT,
            sectionId: SECTION,
            parentId: PARENT,
        })
        expect(
            planMove({
                taskId: 't',
                request: { projectId: PROJECT, sectionId: SECTION, parentId: PARENT },
                current: subtask,
            }),
        ).toEqual({ redundantMoveSkipped: true })
    })

    it('moves a task out of its section when only the project is named', () => {
        const inSection = createMockTask({ projectId: PROJECT, sectionId: SECTION, parentId: null })
        expect(
            planMove({ taskId: 't', request: { projectId: PROJECT }, current: inSection }),
        ).toEqual({ move: { projectId: PROJECT }, redundantMoveSkipped: false })
    })

    it('takes the real destination when an echoed project accompanies a new parent', () => {
        expect(
            planMove({
                taskId: 't',
                request: { projectId: PROJECT, parentId: PARENT },
                current: atProjectRoot,
            }),
        ).toEqual({ move: { parentId: PARENT }, redundantMoveSkipped: true })
    })

    it('rejects a request with more than one real destination', () => {
        expect(() =>
            planMove({
                taskId: 'task-9',
                request: { projectId: 'elsewhere', parentId: PARENT },
                current: atProjectRoot,
            }),
        ).toThrow(
            'Task task-9: Only one of projectId, sectionId, or parentId can be specified at a time',
        )
    })

    it('rejects an ambiguous request when the current state is unknown', () => {
        expect(() =>
            planMove({
                taskId: 'task-9',
                request: { projectId: PROJECT, sectionId: SECTION },
                current: undefined,
            }),
        ).toThrow('Only one of projectId, sectionId, or parentId can be specified at a time')
    })
})
