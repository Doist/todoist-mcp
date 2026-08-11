#!/usr/bin/env npx tsx
/**
 * Measure whether the server's tool surface leads a model to the right tool.
 *
 * The token-footprint test says what the surface costs; it cannot say whether
 * the surface still works. This does: it sends the same tool definitions and
 * instructions a real client sends, gives the model a prompt, and checks which
 * tool it reaches for and how it fills the arguments.
 *
 * It reads the surface from the working tree, so the way to compare two
 * versions is to run it on each and diff the pass rates:
 *
 *   npx tsx scripts/eval-instructions.ts --label before
 *   git stash pop
 *   npx tsx scripts/eval-instructions.ts --label after
 *
 * Tool calls are never executed against Todoist, so this touches no Todoist
 * data and needs no Todoist token. Judging looks at one call per attempt: the
 * first, unless it is a context tool (see CONTEXT_TOOLS), in which case a
 * canned result is fed back and the next call is judged. It does spend money
 * on model calls; see --repeats and --models.
 *
 * Auth uses the Anthropic SDK's standard credential chain: either
 * ANTHROPIC_API_KEY (a key from the Anthropic Console at platform.claude.com),
 * or an OAuth profile created with `ant auth login` — `ant` being Anthropic's
 * CLI, from https://github.com/anthropics/anthropic-cli. A set
 * ANTHROPIC_API_KEY silently overrides a profile; `ant auth status` shows which
 * one is in use. See AGENTS.md for install steps.
 *
 * Usage:
 *   npx tsx scripts/eval-instructions.ts [--label NAME] [--repeats N]
 *                                        [--models a,b] [--scenario ID]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { instructions } from '../src/mcp-server.js'
import { registeredTools } from '../src/tool-registry.js'
import type { UserInfoStructured } from '../src/tools/user-info.js'
import { createLimiter } from '../src/utils/concurrency.js'
import { ToolNames } from '../src/utils/tool-names.js'

/**
 * The user ID the stubbed `user-info` reports. A scenario asking a first-person
 * question can assert the model carried it into a filter argument rather than
 * querying everyone.
 */
const EVAL_USER_ID = '2671355'

type Check = (input: Record<string, unknown>) => string | null

/** First item of a batch tool's array argument, e.g. add-tasks' `tasks`. */
function firstItem(input: Record<string, unknown>, key: string): Record<string, unknown> | null {
    const list = input[key]
    if (!Array.isArray(list) || list.length === 0) return null
    const item = list[0]
    return item && typeof item === 'object' ? (item as Record<string, unknown>) : null
}

type Scenario = {
    id: string
    prompt: string
    /**
     * Any of these counts as the right tool. Use for a rule that names the
     * tool to reach for. Omit when the rule is "don't do X" — an allowlist
     * then fails legitimate lookup steps it did not anticipate, which is
     * noise, not signal.
     */
    expect?: string[]
    /** Calling any of these fails the scenario. Use for "don't do X" rules. */
    forbid?: string[]
    /** Extra assertion on the arguments; return a reason on failure. */
    check?: Check
    /** What this scenario is protecting. */
    guards: string
}

const SCENARIOS: Scenario[] = [
    {
        // The ID is in the prompt on purpose. Without one the model has to
        // search first, which is correct behaviour and tells us nothing about
        // the rule under test.
        id: 'reschedule-not-update',
        prompt: 'Move task 6XG4Vw2c9J ("Weekly review", repeats every Monday) to next Tuesday.',
        // The rule is "not update-tasks", so anything else -- including a
        // preliminary lookup -- is acceptable.
        forbid: [ToolNames.UPDATE_TASKS],
        guards: 'instructions: reschedule-tasks vs update-tasks (recurrence loss)',
    },
    {
        id: 'completed-via-activity',
        prompt: 'What did I actually get done last week?',
        expect: [ToolNames.FIND_ACTIVITY],
        check: (input) => {
            // Exact match: "uncompleted" contains "completed".
            if (input.eventType !== 'completed') {
                return `eventType is ${JSON.stringify(input.eventType)}, not "completed"`
            }
            if (!input.dateFrom || !input.dateTo) {
                return 'no dateFrom/dateTo, so this searches all history rather than last week'
            }
            // find-activity reports every user's events by default, so "what did
            // I get done" answered without this includes collaborators' work.
            if (input.initiatorId !== EVAL_USER_ID) {
                return `initiatorId is ${JSON.stringify(input.initiatorId)}, so this reports every collaborator's completions, not "I"`
            }
            return null
        },
        guards: 'instructions: find-activity vs find-completed-tasks, over a bounded range, filtered to the asker',
    },
    {
        id: 'resolve-person',
        prompt: 'Who is Sarah?',
        expect: [ToolNames.FIND_PROJECT_COLLABORATORS],
        guards: 'instructions: resolving a name to a user ID',
    },
    {
        id: 'subtask-check',
        prompt: 'Does task 6XG4Vw2c9J have any subtasks?',
        expect: [ToolNames.FETCH_OBJECT],
        check: (input) =>
            input.includeChildren === true ? null : 'includeChildren not set to true',
        guards: 'instructions: fetch-object over a speculative find-tasks',
    },
    {
        id: 'label-by-name',
        prompt: 'Show me my tasks labelled urgent.',
        expect: [ToolNames.FIND_TASKS, ToolNames.FIND_LABELS],
        check: (input) => {
            const labels = input.labels
            const used = Array.isArray(labels) ? labels.map(String) : []
            if (used.some((l) => l.toLowerCase() === 'urgent')) return null
            // find-labels legitimately takes a search term rather than a labels array.
            const search = String(input.searchTerm ?? input.name ?? '').toLowerCase()
            return search.includes('urgent')
                ? null
                : `label name not used: ${JSON.stringify(input)}`
        },
        guards: 'instructions: filter by label name, not ID',
    },
    {
        id: 'archive-before-delete',
        prompt: 'Delete workspace project 6XQ3Plan99 ("Q3 Planning").',
        // The rule is "archive first", so the only wrong first move is the
        // delete itself. Archiving and any lookup (find-projects, get-overview,
        // fetch-object) are all legitimate openers.
        forbid: [ToolNames.DELETE_OBJECT],
        guards: 'instructions: workspace projects archive before delete',
    },
    {
        id: 'priority-string',
        prompt: 'Set task 6XG4Vw2c9J to high priority.',
        expect: [ToolNames.UPDATE_TASKS],
        check: (input) => {
            const json = JSON.stringify(input)
            if (/"priority"\s*:\s*"p[1-4]"/.test(json)) return null
            if (/"priority"\s*:\s*\d/.test(json)) return `priority sent as an integer: ${json}`
            return `no p1-p4 priority found: ${json}`
        },
        guards: 'input field description: priority is "p1".."p4", never an integer',
    },
    {
        id: 'recurring-due-string',
        prompt: 'Add a task "Water the plants" due every Monday.',
        expect: [ToolNames.ADD_TASKS],
        check: (input) => {
            const task = firstItem(input, 'tasks')
            if (!task) return `no tasks array: ${JSON.stringify(input)}`
            const dueString = String(task.dueString ?? '')
            // The recurrence has to be in dueString, not smuggled into content.
            if (!dueString.toLowerCase().includes('monday')) {
                return `recurrence not in dueString: ${JSON.stringify(task)}`
            }
            return /^\s*recurring/i.test(dueString)
                ? `dueString prefixed with "recurring": ${dueString}`
                : null
        },
        guards: 'input field description: no "recurring" prefix on dueString',
    },
    {
        id: 'today-includes-overdue',
        prompt: 'Show me the tasks due today.',
        expect: [ToolNames.FIND_TASKS_BY_DATE, ToolNames.GET_OVERVIEW],
        check: (input) => {
            // get-overview takes no date argument; only assert on the dated tool.
            if (!('startDate' in input)) return null
            // A concrete YYYY-MM-DD satisfies the schema but loses the overdue
            // behaviour the keyword carries.
            return input.startDate === 'today'
                ? null
                : `startDate is ${JSON.stringify(input.startDate)}, not the 'today' keyword`
        },
        guards: "input field description: startDate 'today' and its overdue behaviour",
    },
    {
        id: 'no-container-echo',
        prompt: 'Rename task 6XG4Vw2c9J to "Draft the Q4 report".',
        expect: [ToolNames.UPDATE_TASKS],
        check: (input) => {
            const json = JSON.stringify(input)
            return /"(projectId|sectionId|parentId)"/.test(json)
                ? `echoed a container field, which is treated as a move: ${json}`
                : null
        },
        guards: 'instructions: never echo projectId/sectionId/parentId back',
    },
]

const DEFAULT_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5']
const DEFAULT_REPEATS = 5
const MAX_CONCURRENCY = 4

/**
 * Tools a model may legitimately call before the one a scenario is testing, to
 * establish context it has no other way to get — today's date, the user's
 * timezone. "What did I get done last week?" cannot be turned into a date range
 * without them.
 *
 * Judging the very first call outright scores that correct behaviour as a
 * failure: an `expect` allowlist naming the tool under test cannot also name
 * every reasonable lookup that precedes it. So a call to one of these is
 * answered with the canned result below and judging moves to the next call.
 *
 * The result is fiction, but its shape has to be real: a scenario may assert
 * that the model carried a value through (see EVAL_USER_ID), and a model reads
 * a malformed field the way it would read any other bad data. `satisfies` ties
 * it to the tool's own output type, so a renamed or added field breaks here
 * rather than drifting quietly. Formats must match too — `currentLocalTime`
 * is what `toLocaleString('en-US', …)` produces, not ISO.
 */
const CONTEXT_TOOLS: Record<string, unknown> = {
    [ToolNames.USER_INFO]: {
        type: 'user_info',
        userId: EVAL_USER_ID,
        fullName: 'Eval User',
        timezone: 'Europe/London',
        currentLocalTime: '08/11/2026, 09:30:00',
        startDay: 1,
        startDayName: 'Monday',
        weekStartDate: '2026-08-10',
        weekEndDate: '2026-08-16',
        currentWeekNumber: 33,
        completedToday: 3,
        dailyGoal: 5,
        weeklyGoal: 30,
        email: 'eval@example.com',
        plan: 'Todoist Pro',
    } satisfies UserInfoStructured,
}

/**
 * How many context calls an attempt may make before it is judged a failure.
 * A model that keeps gathering context is not answering the question, and
 * without a cap a loop would bill for turns forever.
 */
const MAX_CONTEXT_HOPS = 3

function parseArgs() {
    const args = process.argv.slice(2)
    const get = (flag: string) => {
        const i = args.indexOf(flag)
        return i === -1 ? undefined : args[i + 1]
    }
    const label = get('--label') ?? 'run'
    // The label becomes a filename, so keep it to characters that cannot escape
    // the output directory.
    if (!/^[A-Za-z0-9_-]+$/.test(label)) {
        console.error(`--label must match [A-Za-z0-9_-]+, got "${label}"`)
        process.exit(1)
    }
    return {
        label,
        repeats: Number(get('--repeats') ?? DEFAULT_REPEATS),
        models: (get('--models') ?? DEFAULT_MODELS.join(','))
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean),
        scenario: get('--scenario'),
    }
}

/**
 * The tool definitions as an MCP client forwards them to the Messages API.
 *
 * Note the Messages API tool shape has no output-schema field, so a tool's
 * `outputSchema` never reaches the model here however the server advertises it.
 */
function buildTools(): Anthropic.Tool[] {
    return registeredTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // `InputSchema` carries an index signature, so the extra JSON Schema
        // keys Zod emits pass through rather than being rejected by the cast.
        input_schema: z.toJSONSchema(z.object(tool.parameters), {
            unrepresentable: 'any',
            io: 'input',
            target: 'draft-7',
        }) as Anthropic.Tool.InputSchema,
    }))
}

type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number }

type Attempt = {
    scenario: string
    model: string
    calledTool: string | null
    pass: boolean
    reason: string | null
    /**
     * The request itself failed (auth, rate limit, transport). Distinct from a
     * model that answered but chose wrong — counting these as routing failures
     * would let a run with bad credentials report 0% and be saved as a result.
     */
    errored: boolean
    usage: Usage
    /** Context calls answered with a stub before the judged one. */
    contextHops: number
}

/** Verdict on the one call a scenario is judged by. */
function judge(
    scenario: Scenario,
    call: Anthropic.ToolUseBlock,
): { pass: boolean; reason: string } {
    if (scenario.forbid?.includes(call.name)) {
        return { pass: false, reason: `called ${call.name}, which this rule forbids` }
    }
    if (scenario.expect && !scenario.expect.includes(call.name)) {
        return { pass: false, reason: `expected ${scenario.expect.join(' or ')}` }
    }
    // An argument check written for a specific tool must not run against a
    // different one a forbid-only scenario legitimately allows.
    if (scenario.forbid && !scenario.expect) {
        return { pass: true, reason: '' }
    }
    const reason = scenario.check?.(call.input as Record<string, unknown>) ?? null
    return { pass: reason === null, reason: reason ?? '' }
}

async function runAttempt(
    client: Anthropic,
    model: string,
    scenario: Scenario,
    tools: Anthropic.Tool[],
): Promise<Attempt> {
    const base = {
        scenario: scenario.id,
        model,
        errored: false,
        usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
        contextHops: 0,
    }
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: scenario.prompt }]
    try {
        for (let hop = 0; ; hop++) {
            const response = await client.messages.create({
                model,
                max_tokens: 4096,
                // Tools render before system, so one breakpoint here caches both.
                system: [
                    { type: 'text', text: instructions, cache_control: { type: 'ephemeral' } },
                ],
                tools,
                messages,
            })

            base.usage = {
                input: base.usage.input + response.usage.input_tokens,
                output: base.usage.output + response.usage.output_tokens,
                cacheWrite:
                    base.usage.cacheWrite + (response.usage.cache_creation_input_tokens ?? 0),
                cacheRead: base.usage.cacheRead + (response.usage.cache_read_input_tokens ?? 0),
            }

            const calls = response.content.filter((b) => b.type === 'tool_use')
            const call = calls[0]
            if (!call) {
                return { ...base, calledTool: null, pass: false, reason: 'no tool call' }
            }

            // A turn can carry several calls at once. Judge the substantive one
            // rather than whichever block came first: a model that asks for the
            // date and queries the activity log in the same turn has made its
            // choice, and the order between the two is arbitrary. A forbidden
            // call outranks that — catching it is the point of a forbid rule.
            //
            // A tool a scenario expects is never treated as context, or a
            // scenario testing the route *to* user-info could never pass: its
            // expected call would be stubbed instead of judged.
            const isContext = (c: Anthropic.ToolUseBlock) =>
                Object.hasOwn(CONTEXT_TOOLS, c.name) && !scenario.expect?.includes(c.name)
            const substantive =
                calls.find((c) => scenario.forbid?.includes(c.name)) ??
                calls.find((c) => !isContext(c))
            if (substantive) {
                const { pass, reason } = judge(scenario, substantive)
                return { ...base, calledTool: substantive.name, pass, reason: reason || null }
            }

            // Nothing but context gathering, so answer it and judge what the
            // model reaches for next.
            if (hop >= MAX_CONTEXT_HOPS) {
                return {
                    ...base,
                    calledTool: call.name,
                    pass: false,
                    reason: `still gathering context after ${MAX_CONTEXT_HOPS} calls`,
                }
            }

            base.contextHops = hop + 1
            messages.push({ role: 'assistant', content: response.content })
            messages.push({
                role: 'user',
                content: calls.map((c) => ({
                    type: 'tool_result' as const,
                    tool_use_id: c.id,
                    content: JSON.stringify(CONTEXT_TOOLS[c.name]),
                })),
            })
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
            ...base,
            calledTool: null,
            pass: false,
            errored: true,
            reason: `request failed: ${message}`,
        }
    }
}

async function main() {
    const { label, repeats, models, scenario: only } = parseArgs()
    const scenarios = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS
    if (scenarios.length === 0) {
        console.error(`No scenario matching "${only}"`)
        process.exit(1)
    }

    const client = new Anthropic()
    const tools = buildTools()
    // queueTimeoutMs: 0 disables the default queue deadline, which exists for
    // request-scoped work and does not apply to a batch script.
    const limit = createLimiter(MAX_CONCURRENCY, { queueTimeoutMs: 0 })

    console.log(`label:     ${label}`)
    console.log(`tools:     ${tools.length}`)
    console.log(`scenarios: ${scenarios.length} x ${repeats} repeats x ${models.length} models`)
    console.log(`models:    ${models.join(', ')}\n`)

    const attempts: Attempt[] = []
    for (const model of models) {
        const jobs = scenarios.flatMap((s) => Array.from({ length: repeats }, () => s))
        // Run one first so it writes the shared prefix to cache; the rest read it.
        const first = jobs[0]
        if (!first) continue
        attempts.push(await runAttempt(client, model, first, tools))
        attempts.push(
            ...(await Promise.all(
                jobs.slice(1).map((s) => limit(() => runAttempt(client, model, s, tools))),
            )),
        )
        console.log(`${model}: done`)
    }

    console.log(`\n=== ${label} ===`)
    for (const model of models) {
        console.log(`\n${model}`)
        for (const s of scenarios) {
            const all = attempts.filter((a) => a.model === model && a.scenario === s.id)
            const rows = all.filter((a) => !a.errored)
            const passed = rows.filter((a) => a.pass).length
            const rate = rows.length ? Math.round((passed / rows.length) * 100) : 0
            const mark = rate === 100 ? '✓' : rate >= 60 ? '~' : '✗'
            console.log(`  ${mark} ${String(rate).padStart(3)}%  ${s.id}`)
            const failure = rows.find((a) => !a.pass)
            if (failure) {
                console.log(
                    `           ${failure.calledTool ?? 'no call'} — ${failure.reason ?? ''}`,
                )
            }
        }
        const rows = attempts.filter((a) => a.model === model && !a.errored)
        const passed = rows.filter((a) => a.pass).length
        console.log(`  overall: ${passed}/${rows.length}`)
    }

    const errored = attempts.filter((a) => a.errored)
    if (errored.length > 0) {
        console.error(
            `\n${errored.length}/${attempts.length} requests failed outright ` +
                `(not counted as routing failures). First: ${errored[0]?.reason}`,
        )
    }

    const total = attempts.reduce(
        (acc, a) => ({
            input: acc.input + a.usage.input,
            output: acc.output + a.usage.output,
            cacheWrite: acc.cacheWrite + a.usage.cacheWrite,
            cacheRead: acc.cacheRead + a.usage.cacheRead,
        }),
        { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    )
    console.log(
        `\ntokens: ${total.input} uncached in, ${total.cacheWrite} cache write, ` +
            `${total.cacheRead} cache read, ${total.output} out`,
    )

    mkdirSync('tmp/eval', { recursive: true })
    const out = `tmp/eval/${label}.json`
    writeFileSync(out, JSON.stringify({ label, models, repeats, attempts }, null, 2))
    console.log(`\nwrote ${out}`)

    // A run that could not obtain its samples is not a result to compare against.
    if (errored.length > 0) {
        process.exitCode = 1
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
