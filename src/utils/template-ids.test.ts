import { extractTemplateId } from './template-ids.js'

describe('extractTemplateId', () => {
    it.each([
        {
            name: 'a bare gallery slug',
            input: 'product-launch',
            expected: 'product-launch',
        },
        {
            name: 'a bare personal template ID',
            input: 'UT_28ExampleTemplateId000001',
            expected: 'UT_28ExampleTemplateId000001',
        },
        {
            name: 'a public gallery URL',
            input: 'https://www.todoist.com/templates/product-launch',
            expected: 'product-launch',
        },
        {
            name: 'an in-app personal template URL ending in /view',
            input: 'https://app.todoist.com/app/templates/category/my-templates/UT_28ExampleTemplateId000001/view',
            expected: 'UT_28ExampleTemplateId000001',
        },
        {
            name: 'a local dev URL',
            input: 'https://local.todoist.com/app/templates/category/my-templates/UT_28ExampleTemplateId000002/view',
            expected: 'UT_28ExampleTemplateId000002',
        },
        {
            name: 'a URL with query and hash',
            input: 'https://www.todoist.com/templates/product-launch?ref=nav#top',
            expected: 'product-launch',
        },
        {
            name: 'a URL with a trailing slash',
            input: 'https://www.todoist.com/templates/product-launch/',
            expected: 'product-launch',
        },
        {
            name: 'surrounding whitespace',
            input: '  product-launch  ',
            expected: 'product-launch',
        },
    ])('should resolve $name', ({ input, expected }) => {
        expect(extractTemplateId(input)).toBe(expected)
    })

    it.each([
        {
            name: 'a look-alike host',
            input: 'https://example.com/templates/product-launch',
            error: 'not a Todoist domain',
        },
        {
            name: 'a host that merely ends in the brand name',
            input: 'https://nottodoist.com/templates/product-launch',
            error: 'not a Todoist domain',
        },
        {
            name: 'a Todoist URL that is not a template link',
            input: 'https://app.todoist.com/app/project/123',
            error: 'not a Todoist template URL',
        },
    ])('should reject $name', ({ input, error }) => {
        expect(() => extractTemplateId(input)).toThrow(error)
    })
})
