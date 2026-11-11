# Reviewer brief

Fill in the brackets. Give every reviewer the same brief, plus its role. Leave out your opinion of the change and how you reached it: a reviewer handed a conclusion tends to confirm it.

```
Repository: todoist/todoist-mcp, the Todoist MCP server (TypeScript, Vitest).
The change: `git diff <base>` in <checkout path>, including untracked files.

The task, in the owner's words:
<quote the request; add later clarifications verbatim>

Done means:
<the checkable behaviours, one per line>

Decisions already made:
<each decision and who made it>

Your role: <task review | blast-radius review | code review against .agents/checks/<check>.md>

Rules:
- The working tree at <checkout path> is read-only. Do not edit, stage, commit or run
  scripts there. To run or break code, make your own copy:
  `npm run review:worktree -- <your dir>`, then `npm ci` in it; remove it when done.
- Rate each finding: cited (quote the lines), traced (followed the code path) or ran
  (a test or command showed it). Report only findings you can cite at least.
- For each: severity (P1 wrong or harmful, P2 misleading, P3 minor), file:line, the
  evidence, and the fix in one sentence. No praise, no summary of what is fine.
```

## Role notes

- **Task review:** missing pieces, unrequested changes, unhandled cases, tests that pass with the feature broken, and in a refactor any changed test input, assertion or snapshot. Read each new rule against every skill in `.agents/skills/`, every check in `.agents/checks/` and `AGENTS.md`, and report contradictions.
- **Blast-radius review:** name the one fact the change is safe because of. Prove it by running code in your own worktree. Look past text search: SDK and library versions, API response shapes, what `tools/list` returns, consumers of `src/index.ts`.
- **Code review per check:** apply only that check's "Report" and "Fine" lists.
