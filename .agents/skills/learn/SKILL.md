---
name: learn
description: Turns a correction or a repeated mistake into the strongest structure that prevents it, and proves it catches the mistake. Use when the owner says "don't do that again", "remember this", "you keep doing X", or a review finds the same problem twice.
---

# Learn from a mistake

## 1. Name the mistake

Write the mistake as a check: "a tool's output schema uses `.nullable()`", not "be careful with schemas". Done when a script could, in principle, detect it.

## 2. Pick the strongest structure that holds it

In this order, take the first that works:

1. **A type** the compiler rejects.
2. **A lint rule** in `.oxlintrc.json`.
3. **A test** that scans the code or the registered tools, like `src/tools/output-schema-nullability.test.ts` or `batch-failures-contract.test.ts`.
4. **A script check** in `.agents/scripts/` (verify, a hook).
5. **A line in `AGENTS.md` or a skill**, only if nothing above can hold it.

A rule already written down that still got broken skips straight to 1–4. Done when you can say why the stronger options don't fit.

## 3. Prove it catches the mistake

Make the mistake on purpose. The new structure must fail on it. Remove it: it passes. Run `npm run verify`. Done when you have seen both.

## 4. Delete what it replaces

Remove instruction lines the new check makes redundant, in `AGENTS.md`, skills or `.cursor/rules/`. Update the rules table in `docs/agents.md`: the rule, what holds it, and how certain it is.

## 5. Ship it on its own

One small pull request for the new structure, titled `chore:` or `test:` so it does not release. Done when its diff contains only this rule.
