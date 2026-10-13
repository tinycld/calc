import { describe, expect, it } from 'vitest'
import {
    filterColumnDefaults,
    filterColumnSchema,
    toFilterCriterion,
} from '../tinycld/calc/components/grid/filter-column-schema'

describe('filterColumnSchema', () => {
    it('needs at least one non-blank value for a value op', () => {
        const result = filterColumnSchema.safeParse({
            op: 'eq',
            values: [{ value: '  ' }, { value: '' }],
        })
        expect(result.success).toBe(false)
        expect(result.error?.issues[0].path).toEqual(['values'])
    })

    it('accepts a value op with one non-blank value', () => {
        const result = filterColumnSchema.safeParse({
            op: 'contains',
            values: [{ value: '' }, { value: ' Banana ' }],
        })
        expect(result.success).toBe(true)
    })

    it('needs no value for isEmpty / isNotEmpty', () => {
        expect(
            filterColumnSchema.safeParse({ op: 'isEmpty', values: [{ value: '' }] }).success
        ).toBe(true)
        expect(
            filterColumnSchema.safeParse({ op: 'isNotEmpty', values: [{ value: '' }] }).success
        ).toBe(true)
    })

    it('rejects an unknown op', () => {
        expect(filterColumnSchema.safeParse({ op: 'between', values: [] }).success).toBe(false)
    })
})

describe('toFilterCriterion', () => {
    it('drops blank rows and keeps trimmed values', () => {
        const data = filterColumnSchema.parse({
            op: 'eq',
            values: [{ value: ' A ' }, { value: '' }, { value: 'B' }],
        })
        expect(toFilterCriterion(data)).toEqual({
            type: 'condition',
            condition: { op: 'eq', values: ['A', 'B'] },
        })
    })

    it('stores no values for isEmpty', () => {
        const data = filterColumnSchema.parse({ op: 'isEmpty', values: [{ value: 'x' }] })
        expect(toFilterCriterion(data)).toEqual({
            type: 'condition',
            condition: { op: 'isEmpty' },
        })
    })
})

describe('filterColumnDefaults', () => {
    it('starts with eq and one blank row when there is no condition', () => {
        expect(filterColumnDefaults(undefined)).toEqual({ op: 'eq', values: [{ value: '' }] })
        expect(filterColumnDefaults({ type: 'values', allowedValues: ['a'] })).toEqual({
            op: 'eq',
            values: [{ value: '' }],
        })
    })

    it('seeds from an existing condition', () => {
        expect(
            filterColumnDefaults({ type: 'condition', condition: { op: 'gt', values: ['1', '2'] } })
        ).toEqual({ op: 'gt', values: [{ value: '1' }, { value: '2' }] })
        expect(filterColumnDefaults({ type: 'condition', condition: { op: 'isEmpty' } })).toEqual({
            op: 'isEmpty',
            values: [{ value: '' }],
        })
    })
})
