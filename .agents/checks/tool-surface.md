# Check: tool surface

What models see: tool names, descriptions, input and output schemas, the `instructions` string. Every change here reaches every client.

## Report

- A changed tool or field description, or `instructions` text, with no `npm run eval` before/after result in the description. Ask for it; don't assume it's fine.
- A description that contradicts the tool's behaviour or another tool's description.
- Output field descriptions that restate the field name (see "Describing output schema fields" in `AGENTS.md`).
- A renamed or removed tool, or a renamed input field, without a breaking-change PR title. Clients and saved prompts call them by name.
- Token cost growing well past what the change needs (`src/token-footprint.test.ts` budget raised).

## Fine

- Wording fixes inside one description with an eval run, or a small typo fix without one.
