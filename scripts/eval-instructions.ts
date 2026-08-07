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
 * Tool calls are never executed — only the first call of each turn is
 * inspected — so this touches no Todoist data and needs no Todoist token. It
 * does spend money on model calls; see --repeats and --models.
 *
 * Auth comes from the standard Anthropic credential chain, so `ant auth login`
 * is enough (no ANTHROPIC_API_KEY needed).
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
import { ToolNames } from '../src/utils/tool-names.js'

type Check = (input: Record<string, unknown>) => string | null

type Scenario = {
    id: string
    prompt: string
    /** Any of these counts as the right tool. */
    expect: string[]
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
        expect: [ToolNames.RESCHEDULE_TASKS],
        guards: 'instructions: reschedule-tasks vs update-tasks (recurrence loss)',
    },
    {
        id: 'completed-via-activity',
        prompt: 'What did I actually get done last week?',
        expect: [ToolNames.FIND_ACTIVITY],
        check: (input) => {
            const json = JSON.stringify(input)
            return json.includes('completed') ? null : `eventType not "completed": ${json}`
        },
        guards: 'instructions: find-activity vs find-completed-tasks',
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
            const json = JSON.stringify(input).toLowerCase()
            return json.includes('urgent') ? null : `label name not used: ${json}`
        },
        guards: 'instructions: filter by label name, not ID',
    },
    {
        id: 'archive-before-delete',
        prompt: 'Delete workspace project 6XQ3Plan99 ("Q3 Planning").',
        expect: [
            ToolNames.PROJECT_MANAGEMENT,
            ToolNames.FIND_PROJECTS,
            ToolNames.GET_OVERVIEW,
            ToolNames.DELETE_OBJECT,
        ],
        check: (input) => {
            const json = JSON.stringify(input).toLowerCase()
            // Deleting straight off a name it was never given is the failure.
            return json.includes('q3') || Object.keys(input).length === 0
                ? null
                : `did not reference the named project: ${json}`
        },
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
            const json = JSON.stringify(input).toLowerCase()
            if (!json.includes('monday')) return `recurrence missing: ${json}`
            return /"duestring"\s*:\s*"recurring/.test(json)
                ? `dueString prefixed with "recurring": ${json}`
                : null
        },
        guards: 'input field description: no "recurring" prefix on dueString',
    },
    {
        id: 'today-includes-overdue',
        prompt: 'What should I focus on today?',
        expect: [ToolNames.FIND_TASKS_BY_DATE, ToolNames.GET_OVERVIEW],
        guards: "input field description: startDate 'today'",
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

function parseArgs() {
    const args = process.argv.slice(2)
    const get = (flag: string) => {
        const i = args.indexOf(flag)
        return i === -1 ? undefined : args[i + 1]
    }
    return {
        label: get('--label') ?? 'run',
        repeats: Number(get('--repeats') ?? DEFAULT_REPEATS),
        models: (get('--models') ?? DEFAULT_MODELS.join(',')).split(','),
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
    usage: Usage
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
        usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    }
    try {
        const response = await client.messages.create({
            model,
            max_tokens: 4096,
            // Tools render before system, so one breakpoint here caches both.
            system: [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }],
            tools,
            messages: [{ role: 'user', content: scenario.prompt }],
        })

        base.usage = {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
            cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
            cacheRead: response.usage.cache_read_input_tokens ?? 0,
        }

        const call = response.content.find((b) => b.type === 'tool_use')
        if (!call) {
            return { ...base, calledTool: null, pass: false, reason: 'no tool call' }
        }
        if (!scenario.expect.includes(call.name)) {
            return {
                ...base,
                calledTool: call.name,
                pass: false,
                reason: `expected ${scenario.expect.join(' or ')}`,
            }
        }
        const reason = scenario.check?.(call.input as Record<string, unknown>) ?? null
        return { ...base, calledTool: call.name, pass: reason === null, reason }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ...base, calledTool: null, pass: false, reason: `error: ${message}` }
    }
}

async function mapWithLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = next++
            if (index >= items.length) return
            const item = items[index]
            if (item === undefined) return
            results[index] = await fn(item)
        }
    })
    await Promise.all(workers)
    return results
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
            ...(await mapWithLimit(jobs.slice(1), MAX_CONCURRENCY, (s) =>
                runAttempt(client, model, s, tools),
            )),
        )
        console.log(`${model}: done`)
    }

    console.log(`\n=== ${label} ===`)
    for (const model of models) {
        console.log(`\n${model}`)
        for (const s of scenarios) {
            const rows = attempts.filter((a) => a.model === model && a.scenario === s.id)
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
        const rows = attempts.filter((a) => a.model === model)
        const passed = rows.filter((a) => a.pass).length
        console.log(`  overall: ${passed}/${rows.length}`)
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
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
