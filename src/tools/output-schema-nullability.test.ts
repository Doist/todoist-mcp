import { describeOutputSchemaNullability } from '@todoist/mcp-core/testing'
import { registeredTools } from '../tool-registry.js'

/**
 * Structured content is sanitised with `removeNullFields` on its way out, so no
 * null ever reaches a client. A tool that declares an output field as nullable
 * therefore promises a value it can never send: the MCP SDK validates the
 * sanitised payload against the declared output schema and fails the whole call
 * with "Output validation error" as soon as that field is stripped.
 *
 * The shape that survives sanitisation is `.optional()` with the key left out of
 * `structuredContent` when there is nothing to report.
 */
describeOutputSchemaNullability(registeredTools)
