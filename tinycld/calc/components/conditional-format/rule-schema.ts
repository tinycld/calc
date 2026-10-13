import { z } from '@tinycld/core/ui/form'
import { parseSheetRange } from '../../lib/conditional-format/a1'
import type { CFCondition, CFConditionType, CFRule } from '../../lib/conditional-format/types'
import type { CellStyle } from '../../lib/workbook-types'

export function operandCount(type: CFConditionType): 0 | 1 | 2 {
    if (
        type === 'isEmpty' ||
        type === 'isNotEmpty' ||
        type === 'customFormula' ||
        type === 'xlsxOpaque'
    )
        return 0
    if (type === 'numberBetween' || type === 'numberNotBetween') return 2
    return 1
}

// The doc stores each range as its own array element, so the comma list
// the user types is split here.
function splitRanges(value: string): string[] {
    return value
        .split(',')
        .map(r => r.trim())
        .filter(r => r !== '')
}

// The A1 parser only accepts upper-case column letters, so `a1:a10` is
// upper-cased before the check rather than stored as a range that never
// matches a cell.
const rangesSchema = z
    .string()
    .trim()
    .toUpperCase()
    .superRefine((value, ctx) => {
        const parts = splitRanges(value)
        if (parts.length === 0) {
            ctx.addIssue({ code: 'custom', message: 'Enter a range, e.g. A1:A100.' })
            return
        }
        const invalid = parts.find(part => parseSheetRange(part) == null)
        if (invalid != null) {
            ctx.addIssue({ code: 'custom', message: `"${invalid}" is not a valid range.` })
        }
    })
    .transform(splitRanges)

export const ruleEditorSchema = z
    .object({
        ranges: rangesSchema,
        conditionType: z.custom<CFConditionType>(value => typeof value === 'string'),
        value1: z.string().trim(),
        value2: z.string().trim(),
        formula: z.string().trim(),
        style: z.custom<CellStyle>(value => typeof value === 'object' && value !== null),
    })
    .superRefine((data, ctx) => {
        const count = operandCount(data.conditionType)
        if (count >= 1 && data.value1 === '') {
            ctx.addIssue({ code: 'custom', path: ['value1'], message: 'Enter a value.' })
        }
        if (count === 2 && data.value2 === '') {
            ctx.addIssue({ code: 'custom', path: ['value2'], message: 'Enter an end value.' })
        }
        if (data.conditionType === 'customFormula' && data.formula === '') {
            ctx.addIssue({ code: 'custom', path: ['formula'], message: 'Enter a formula.' })
        }
    })

export type RuleEditorFormValues = z.input<typeof ruleEditorSchema>
export type RuleEditorOutput = z.output<typeof ruleEditorSchema>

export function ruleEditorDefaults(rule: CFRule): RuleEditorFormValues {
    return {
        ranges: rule.ranges.join(','),
        conditionType: rule.condition.type,
        value1: rule.condition.value1 ?? '',
        value2: rule.condition.value2 ?? '',
        formula: rule.condition.formula ?? '',
        style: rule.style,
    }
}

// toRule assembles the parsed form output into the stored rule. Operands
// the chosen condition does not use are dropped. An imported rule kind the
// editor cannot model keeps its original options blob so a save does not
// lose it.
export function toRule(rule: CFRule, data: RuleEditorOutput): CFRule {
    const count = operandCount(data.conditionType)
    const condition: CFCondition = { type: data.conditionType }
    if (count >= 1) condition.value1 = data.value1
    if (count === 2) condition.value2 = data.value2
    if (data.conditionType === 'customFormula') condition.formula = data.formula
    if (data.conditionType === 'xlsxOpaque' && rule.condition.opaqueXlsx != null) {
        condition.opaqueXlsx = rule.condition.opaqueXlsx
    }
    return { id: rule.id, ranges: data.ranges, condition, style: data.style }
}
