# Temporary due-mutation diagnostics

Related to https://github.com/Doist/Issues/issues/21505.

These opt-in diagnostics distinguish caller-selected due-rule replacement from
recurrence lost during SDK serialization or downstream persistence. They do **not**
fix recurrence loss, change `update-tasks` semantics, rewrite recurrence strings,
or establish which tool the original automation used. Tool descriptions, schemas,
and server instructions are unchanged.

## Activation and observation window

1. Deploy the instrumented package to the hosted MCP consumer and verify its
   **runtime** MCP version. Package publication alone is not deployment evidence.
2. Enable `TODOIST_MCP_DUE_DIAGNOSTICS=1` in that consumer's environment. The default
   is disabled; any other value disables admission and emission.
3. Confirm extraction of the single-line JSON event from stderr in the hosted log
   pipeline, including its `level: "info"` field. `console.error` is used only for
   stderr routing, following the existing batch-failure logger; stdout remains the
   stdio MCP protocol. Discover the actual service facet rather than assuming one.
4. Observe for **7 days after verified deployment with the flag enabled**, then
   unset the flag. There is no automatic deployment date or expiry in this patch.
   Monitor added reads, sampled-call latency, and log volume during rollout; disable
   the flag early if necessary. Logging-round counts and observation dates remain
   owned by the application/operator, not this code.

Do not ask the affected user to re-enable a destructive automation for evidence.
Use ordinary sampled traffic and controlled tests with disposable tasks. Existing
saved automation runs, manifests, allowlists, arguments, and generated/cached code
may resolve the original incident sooner through an authorized Automations engineer.

## Sampling, cost, and safety

- Eligible entries are **normalized** `update-tasks` changes with a supplied
  `dueString`, including explicit clearing, and all `reschedule-tasks` occurrence
  moves. Duration-only updates are ineligible.
- One eligible entry is selected uniformly per admitted batch, with a shared
  rolling limit of **10 batches/minute/process** across both tools. Slots stay
  occupied until settlement and for one minute afterwards, so slow/queued batches
  reduce coverage rather than bursting reads or events when they drain. This admits
  at most 600 sampled batches/hour/process; each emits at most one result event.
  `eligibleCount` and `sampledCount: 1` describe coverage, not the whole batch size.
- `update-tasks` reuses a suitable existing move/container snapshot when available;
  otherwise it attempts one optional `getTask` immediately before the selected field
  write, bounded to **2 seconds**. The tracked transport prevents SDK retries from
  sending another optional read and forwards its abort signal. Late settlement is
  handled. This adds at most **10 pre-state requests/minute/process** on the tracked
  transport, without changing normal read/write retries.
- `reschedule-tasks` uses only its existing pre-fetches and re-fetches. A failed Sync
  or re-fetch never counts as proof that recurrence was preserved.
- Transport observation works on clients using `createTrackedFetch` (including
  `createTodoistClient`). External SDK clients without that wrapper may report
  `unobserved`; their transport behavior is outside this wrapper's control.
- Only JSON string request bodies of at most **64 KiB** are parsed. Other bodies
  are not read, cloned, consumed, or changed. Only the selected task-update path or
  selected `item_update` command (matched by task ID **and command UUID**) is inspected.
- Events contain allowlisted fields only, at most **1,280 bytes**, with up to three
  most recent generated request IDs (fewer if needed for the size cap). No response
  body, full URL, authentication header, raw error, title, description, calendar
  detail, due rule/date/time, timezone, or token is logged. Rule comparisons happen
  only in memory, and rule references are dropped after settlement. Diagnostic
  failures, including stderr failures, do not change tool results or errors.

## Event fields

Event: `todoist_due_mutation_diagnostic`, `diagnosticVersion: 1`.

- `mcpVersion`, `tool`, `operationId`, `taskId`: runtime package/tool and sampled
  operation identity. Task IDs follow the existing failure-logging convention,
  restricted to bounded identifier characters; other input is redacted.
- `writeStartedAt`, `writeFinishedAt`, `requestIds`: ISO write times and existing
  generated API request IDs for correlation. Times are `not_started` when no
  field/Sync write ran. Pre/post-read IDs are excluded.
- `eligibleCount`, `sampledCount`: eligible entries in the batch and entries
  sampled. Rate-limited batches emit nothing.
- `preReadStatus`: `success`, `reused`, `error`, `timeout`, or `not_attempted`.
  Read failures cannot affect write arguments.
- `beforeDueState`, `afterDueState`: `recurring`, `one_time`, `none`, or `unknown`.
  The after-state comes from the returned field update or successful reschedule
  re-fetch, never just a successful move.
- `requestedMode`, `explicitClear`, `inputMatchesPriorRule`, `durationSupplied`:
  `replace_string` versus `preserve_occurrence`; whether the normalized input
  explicitly clears the date, equals the prior rule, or includes duration.
- `constructedRecurring`, `constructedRuleMatchesBefore`: whether the preserving
  tool constructed recurring metadata and retained the prior rule. Not applicable
  to replacement calls.
- `wireObservation`: `observed`, `unobserved`, `unsupported_body`, `oversize_body`,
  `invalid_json`, or `command_missing`. These describe the **last matched transport
  attempt**.
- `wireRecurring`, `wireRulePresent`, `wireRuleMatchesBefore`: structural fields
  after SDK serialization. Missing/unobserved recurrence is `unknown`, not `false`;
  the REST replacement endpoint's recurring flag is `not_applicable`. Equality is
  unknown when a rule is unavailable.
- `endpoint`, `httpStatus`, `attemptCount`, `retryCount`: endpoint class
  (`task_update`, `sync`, or `unknown`), last matched attempt's status (or `unknown`
  on transport failure), and aggregate matched transport attempts/retries within
  this write. Zero attempts can mean an uninstrumented transport, not proof that
  no write occurred.
- `result`, `moveApplied`: `succeeded`, `failed`, `unknown` (Sync succeeded but
  re-fetch failed), or `not_attempted`. A field failure after a successful move has
  `result: failed`, `moveApplied: true`, and unknown after-state. Failed writes can
  still have unknown persistence. Move state can itself be unknown.

Comparison/presence flags use booleans only when observed, otherwise `unknown` or
`not_applicable`. A Sync error for another command can leave the sampled command's
persistence unknown too. Snapshots are not transactions: interleaved writers remain
possible even when the constructed and wire fields agree.

## Queries and interpretation

After confirming JSON field extraction, restrict queries to the verified deployed
`@mcpVersion` and the seven-day interval, plus the discovered hosted service facet:

```text
@event:todoist_due_mutation_diagnostic
@event:todoist_due_mutation_diagnostic @beforeDueState:recurring @afterDueState:one_time
@event:todoist_due_mutation_diagnostic @beforeDueState:recurring @afterDueState:none
@event:todoist_due_mutation_diagnostic @tool:update-tasks
@event:todoist_due_mutation_diagnostic @tool:reschedule-tasks
```

- **Recurring → one-time/none on `update-tasks`, unequal prior rule, no explicit
  clear:** supports caller-selected replacement. Correlate request IDs, task ID,
  and write times with API and Automations run records. Inspect the saved step's
  prompt, allowlist, arguments, and generated/cached code to distinguish unintended
  time-block scheduling from an intentional rule edit. Not every removal is a defect.
- **Preserving constructed metadata, missing/different wire metadata:** isolates
  request construction/SDK serialization. Unobserved or unsupported bodies are not
  evidence of omission.
- **Preserving constructed and wire metadata, nonrecurring re-fetch:** points to API
  persistence or an interleaved write. Request-correlated backend records are needed
  before proposing a local fix.
- **Only preserving samples, unknown states, or no relevant events:** the cause is
  still unestablished. Sampling is not proof of absence. Obtain a sanitized saved
  run/manifest or controlled reproduction; investigate other writers/unsampled calls.

No release, root-cause confirmation, or scheduled reinvestigation is implied by this
instrumentation. The observation window starts only after the deployment and flag
checks above.
