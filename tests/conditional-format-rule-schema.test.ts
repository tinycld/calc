import { describe, expect, it } from 'vitest'
import {
    ruleEditorDefaults,
    ruleEditorSchema,
    toRule,
} from '../tinycld/calc/components/conditional-format/rule-schema'
import type { CFRule } from '../tinycld/calc/lib/conditional-format/types'

const rule: CFRule = {
    id: 'r1',
    ranges: ['A1:A10'],
    condition: { type: 'numberGreater', value1: '5' },
    style: { font: { bold: true } },
}

function draft(overrides: Partial<ReturnType<typeof ruleEditorDefaults>> = {}) {
    return { ...ruleEditorDefaults(rule), ...overrides }
}

function issuePaths(input: unknown) {
    const result = ruleEditorSchema.safeParse(input)
    return result.error?.issues.map(i => i.path.join('.')) ?? []
}

describe('ruleEditorSchema ranges', () => {
    it('splits, trims and upper-cases a comma list', () => {
        const result = ruleEditorSchema.parse(draft({ ranges: ' a1:a10 , C:C,,B2 ' }))
        expect(result.ranges).toEqual(['A1:A10', 'C:C', 'B2'])
    })

    it('rejects an empty range list', () => {
        expect(issuePaths(draft({ ranges: ' , ' }))).toEqual(['ranges'])
    })

    it('rejects an invalid range and names it', () => {
        const result = ruleEditorSchema.safeParse(draft({ ranges: 'A1:A10,foo bar' }))
        expect(result.error?.issues[0].message).toBe('"FOO BAR" is not a valid range.')
    })
})

describe('ruleEditorSchema operands', () => {
    it('needs value1 for a one-operand condition', () => {
        expect(issuePaths(draft({ value1: '  ' }))).toEqual(['value1'])
    })

    it('needs both values for between', () => {
        expect(
            issuePaths(draft({ conditionType: 'numberBetween', value1: '', value2: '' }))
        ).toEqual(['value1', 'value2'])
    })

    it('needs a formula for customFormula', () => {
        expect(issuePaths(draft({ conditionType: 'customFormula', formula: ' ' }))).toEqual([
            'formula',
        ])
    })

    it('needs no operand for isEmpty', () => {
        expect(issuePaths(draft({ conditionType: 'isEmpty', value1: '' }))).toEqual([])
    })
})

describe('toRule', () => {
    it('keeps only the operands the condition uses', () => {
        const data = ruleEditorSchema.parse(
            draft({ conditionType: 'textContains', value1: ' x ', value2: 'y', formula: 'z' })
        )
        expect(toRule(rule, data)).toEqual({
            id: 'r1',
            ranges: ['A1:A10'],
            condition: { type: 'textContains', value1: 'x' },
            style: { font: { bold: true } },
        })
    })

    it('keeps the imported options blob of an opaque rule', () => {
        const opaque: CFRule = {
            ...rule,
            condition: { type: 'xlsxOpaque', opaqueXlsx: { type: 'top' } },
        }
        const data = ruleEditorSchema.parse(ruleEditorDefaults(opaque))
        expect(toRule(opaque, data).condition).toEqual({
            type: 'xlsxOpaque',
            opaqueXlsx: { type: 'top' },
        })
    })
})
