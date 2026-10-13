import { describe, expect, it } from 'vitest'
import { namedRangeSchemaFor } from '../tinycld/calc/components/named-ranges/named-range-schema'

const acceptAll = () => true
const base = { name: 'TaxRate', expression: '=0.085', scope: null, comment: '' }

function messagesFor(result: { success: boolean; error?: { issues: { message: string }[] } }) {
    return result.error?.issues.map(i => i.message) ?? []
}

describe('namedRangeSchemaFor', () => {
    it('accepts a valid entry and trims name, expression and comment', () => {
        const result = namedRangeSchemaFor(acceptAll).safeParse({
            ...base,
            name: '  TaxRate ',
            expression: ' =0.085 ',
            comment: '  rate  ',
        })
        expect(result.success).toBe(true)
        expect(result.data).toEqual({
            name: 'TaxRate',
            expression: '=0.085',
            scope: null,
            comment: 'rate',
        })
    })

    it('reports the name rule that failed', () => {
        const schema = namedRangeSchemaFor(acceptAll)
        expect(messagesFor(schema.safeParse({ ...base, name: '   ' }))).toEqual([
            'Name cannot be empty.',
        ])
        expect(messagesFor(schema.safeParse({ ...base, name: '1abc' }))).toEqual([
            'Name must start with a letter or underscore.',
        ])
        expect(messagesFor(schema.safeParse({ ...base, name: 'A1' }))).toEqual([
            'Name cannot look like a cell reference (e.g. A1 or Q4).',
        ])
    })

    it('rejects a whitespace-only expression', () => {
        const result = namedRangeSchemaFor(acceptAll).safeParse({ ...base, expression: '   ' })
        expect(messagesFor(result)).toEqual(['Expression cannot be empty.'])
    })

    it('runs the formula check only for input that starts with =', () => {
        const rejectAll = () => false
        const schema = namedRangeSchemaFor(rejectAll)
        expect(messagesFor(schema.safeParse({ ...base, expression: '=SUM(' }))).toEqual([
            'Expression is not a valid formula.',
        ])
        expect(schema.safeParse({ ...base, expression: 'Quarterly' }).success).toBe(true)
    })

    it('passes the trimmed formula to the validator', () => {
        const seen: string[] = []
        namedRangeSchemaFor(f => {
            seen.push(f)
            return true
        }).safeParse({ ...base, expression: '  =Sheet1!$A$1  ' })
        expect(seen).toEqual(['=Sheet1!$A$1'])
    })

    it('accepts a sheet scope', () => {
        const result = namedRangeSchemaFor(acceptAll).safeParse({ ...base, scope: 'sheet1' })
        expect(result.data?.scope).toBe('sheet1')
    })
})
