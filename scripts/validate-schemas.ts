#!/usr/bin/env node

/**
 * Schema Validation Script for Todoist MCP Server
 *
 * This script validates that all tool parameter schemas follow Gemini API compatibility rules.
 * Specifically, it checks that no Zod string schemas use both .nullable() and .optional().
 *
 * This version imports the actual tools from the compiled index.js and validates their
 * runtime Zod schemas for maximum accuracy.
 *
 * Usage:
 *   npm run build && node scripts/validate-schemas.js
 *   npm run build && node scripts/validate-schemas.js --verbose
 *   npm run build && node scripts/validate-schemas.js --json
 */

import { z } from 'zod'

type ValidationIssue = {
    toolName: string
    parameterPath: string
    issue: string
    suggestion: string
}

type ValidationResult = {
    success: boolean
    issues: ValidationIssue[]
    toolsChecked: number
    parametersChecked: number
}

type AnyZodSchema = z.ZodTypeAny | { _zod: { def: unknown } }

/**
 * Recursively walk a Zod schema and detect problematic patterns
 */
function walkZodSchema(
    schema: AnyZodSchema,
    path: string,
    issues: ValidationIssue[],
    toolName: string,
): void {
    // Check for ZodOptional containing a ZodNullable ZodString
    if (schema instanceof z.ZodOptional) {
        const innerSchema = schema.unwrap()
        if (innerSchema instanceof z.ZodNullable) {
            const nullableInner = innerSchema.unwrap()
            if (nullableInner instanceof z.ZodString) {
                issues.push({
                    toolName,
                    parameterPath: path,
                    issue: 'GEMINI_API_INCOMPATIBLE: z.string().nullable().optional() pattern detected',
                    suggestion:
                        'REQUIRED FIX: Change "z.string().nullable().optional()" to "z.string().optional()" and use special strings like "remove" or "unassign" in description to handle clearing. This pattern causes HTTP 400 errors in Google Gemini API due to OpenAPI 3.1 nullable type incompatibility.',
                })
            }
        }
    }

    // Check for ZodNullable containing a ZodOptional ZodString
    if (schema instanceof z.ZodNullable) {
        const innerSchema = schema.unwrap()
        if (innerSchema instanceof z.ZodOptional) {
            const optionalInner = innerSchema.unwrap()
            if (optionalInner instanceof z.ZodString) {
                issues.push({
                    toolName,
                    parameterPath: path,
                    issue: 'GEMINI_API_INCOMPATIBLE: z.string().optional().nullable() pattern detected',
                    suggestion:
                        'REQUIRED FIX: Change "z.string().optional().nullable()" to "z.string().optional()" and use special strings like "remove" or "unassign" in description to handle clearing. This pattern causes HTTP 400 errors in Google Gemini API due to OpenAPI 3.1 nullable type incompatibility.',
                })
            }
        }
    }

    // Recursively check nested schemas
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape
        for (const [key, value] of Object.entries(shape)) {
            const newPath = path ? `${path}.${key}` : key
            walkZodSchema(value as AnyZodSchema, newPath, issues, toolName)
        }
    } else if (schema instanceof z.ZodArray) {
        const element = (schema as unknown as { _zod: { def: { element: AnyZodSchema } } })._zod.def
            .element
        walkZodSchema(element, `${path}[]`, issues, toolName)
    } else if (
        schema instanceof z.ZodOptional ||
        schema instanceof z.ZodNullable ||
        schema instanceof z.ZodDefault
    ) {
        walkZodSchema(schema.unwrap() as AnyZodSchema, path, issues, toolName)
    } else if (schema instanceof z.ZodUnion) {
        const options = (schema as unknown as { _zod: { def: { options: AnyZodSchema[] } } })._zod
            .def.options
        options.forEach((option: AnyZodSchema, index: number) => {
            walkZodSchema(option, `${path}[union:${index}]`, issues, toolName)
        })
    } else if (schema instanceof z.ZodDiscriminatedUnion) {
        const options = (schema as unknown as { _zod: { def: { options: AnyZodSchema[] } } })._zod
            .def.options
        options.forEach((option: AnyZodSchema, index: number) => {
            walkZodSchema(option, `${path}[union:${index}]`, issues, toolName)
        })
    } else if (schema instanceof z.ZodIntersection) {
        const left = (schema as unknown as { _zod: { def: { left: AnyZodSchema } } })._zod.def.left
        const right = (schema as unknown as { _zod: { def: { right: AnyZodSchema } } })._zod.def
            .right
        walkZodSchema(left, `${path}[left]`, issues, toolName)
        walkZodSchema(right, `${path}[right]`, issues, toolName)
    } else if (schema instanceof z.ZodRecord) {
        const valueType = (schema as unknown as { _zod: { def: { valueType: AnyZodSchema } } })._zod
            .def.valueType
        walkZodSchema(valueType, `${path}[value]`, issues, toolName)
    } else if (schema instanceof z.ZodTuple) {
        const items = (schema as unknown as { _zod: { def: { items: AnyZodSchema[] } } })._zod.def
            .items
        items.forEach((item: AnyZodSchema, index: number) => {
            walkZodSchema(item, `${path}[${index}]`, issues, toolName)
        })
    }
}

/**
 * Validate a single tool's parameter schema
 */
function validateToolSchema(tool: {
    name?: string
    parameters?: Record<string, z.ZodTypeAny>
}): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const toolName = tool.name || 'unknown'

    if (!tool.parameters) {
        return issues
    }

    try {
        const schema = z.object(tool.parameters)
        walkZodSchema(schema, '', issues, toolName)
    } catch (error) {
        issues.push({
            toolName,
            parameterPath: 'root',
            issue: `Failed to analyze schema: ${error}`,
            suggestion: 'Check that the tool parameters are valid Zod schemas',
        })
    }

    return issues
}

/**
 * Main validation function using runtime schema analysis
 */
async function validateAllSchemas(verbose: boolean = false): Promise<ValidationResult> {
    try {
        const { tools } = await import(`${process.cwd()}/dist/index.js`)

        const allIssues: ValidationIssue[] = []
        let totalParameters = 0
        const toolNames = Object.keys(tools)

        for (const toolName of toolNames) {
            const tool = tools[toolName]
            const toolIssues = validateToolSchema(tool)
            allIssues.push(...toolIssues)

            // Count parameters for stats
            if (tool.parameters) {
                try {
                    const schema = z.object(tool.parameters)
                    const shape = schema.shape
                    if (shape) {
                        totalParameters += Object.keys(shape).length
                    }
                } catch {
                    // Skip counting if schema is invalid
                }
            }

            if (verbose) {
                const issueCount = toolIssues.length
                const status = issueCount === 0 ? '✅' : `❌ (${issueCount} issues)`
                const paramCount = tool.parameters ? Object.keys(tool.parameters).length : 0
                console.log(`${status} ${toolName} (${paramCount} parameters)`)

                if (issueCount > 0) {
                    toolIssues.forEach((issue) => {
                        console.log(`    ${issue.parameterPath}: ${issue.issue}`)
                    })
                }
            }
        }

        return {
            success: allIssues.length === 0,
            issues: allIssues,
            toolsChecked: toolNames.length,
            parametersChecked: totalParameters,
        }
    } catch (error) {
        return {
            success: false,
            issues: [
                {
                    toolName: 'system',
                    parameterPath: 'import',
                    issue: `Failed to import tools: ${error}`,
                    suggestion: 'Ensure the project is built and dist/index.js exists',
                },
            ],
            toolsChecked: 0,
            parametersChecked: 0,
        }
    }
}

/**
 * CLI interface
 */
async function main() {
    const args = process.argv.slice(2)
    const verbose = args.includes('--verbose')
    const jsonOutput = args.includes('--json')

    try {
        const result = await validateAllSchemas(verbose)

        if (jsonOutput) {
            console.log(JSON.stringify(result, null, 2))
        } else {
            if (result.success) {
                console.log('✅ Schema validation passed!')
                console.log(
                    `   Checked ${result.toolsChecked} tools with ${result.parametersChecked} parameters`,
                )
                console.log(
                    '   All schemas are Gemini API compatible (no .nullable() on optional strings)',
                )
            } else {
                console.log('❌ Schema validation failed!')
                console.log(
                    `   Found ${result.issues.length} issue(s) in ${result.toolsChecked} tools:\n`,
                )

                result.issues.forEach((issue, index) => {
                    console.log(`\n${index + 1}. 🚫 VALIDATION FAILURE`)
                    console.log(`   Tool: ${issue.toolName}`)
                    console.log(`   Parameter: ${issue.parameterPath}`)
                    console.log(`   Issue: ${issue.issue}`)
                    console.log(`   Action Required: ${issue.suggestion}`)
                    console.log(`   File Location: src/tools/${issue.toolName}.ts`)
                    console.log(`   Fix Pattern: Remove .nullable() from the parameter schema`)
                    console.log(
                        `   Example Fix: Change z.string().nullable().optional() → z.string().optional()`,
                    )
                    console.log(
                        `   ⚠️  This validation failure will cause Gemini API HTTP 400 errors\n`,
                    )
                })
            }
        }

        process.exit(result.success ? 0 : 1)
    } catch (error) {
        console.error('Fatal error during schema validation:', error)
        process.exit(1)
    }
}

// Run if this script is executed directly
if (
    process.argv[1]?.endsWith('validate-schemas.ts') ||
    process.argv[1]?.endsWith('validate-schemas.js')
) {
    main()
}

export type { ValidationIssue, ValidationResult }
export { validateAllSchemas }
