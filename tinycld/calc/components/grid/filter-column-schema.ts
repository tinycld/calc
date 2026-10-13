import { z } from '@tinycld/core/ui/form'
import type { FilterCondition, FilterCriterion } from '../../lib/filter'

export const FILTER_CONDITION_OPS = [
    'eq',
    'neq',
    'gt',
    'lt',
    'contains',
    'startsWith',
    'endsWith',
    'isEmpty',
    'isNotEmpty',
] as const satisfies readonly FilterCondition['op'][]

export function opNeedsValues(op: FilterCondition['op']): boolean {
    return op !== 'isEmpty' && op !== 'isNotEmpty'
}

// Values are `{ value }` objects because useFieldArray keys rows by object
// identity; a plain string[] cannot be a field array.
export const filterColumnSchema = z
    .object({
        op: z.enum(FILTER_CONDITION_OPS),
        values: z.array(z.object({ value: z.string().trim() })),
    })
    .superRefine((data, ctx) => {
        if (!opNeedsValues(data.op)) return
        if (data.values.some(v => v.value.length > 0)) return
        ctx.addIssue({
            code: 'custom',
            path: ['values'],
            message: 'Enter a value for this condition.',
        })
    })

export type FilterColumnFormValues = z.input<typeof filterColumnSchema>

// filterColumnDefaults seeds the form from the column's existing criterion.
// Only condition-shaped criteria are editable here; values-style ones come
// from the header dropdown.
export function filterColumnDefaults(initial: FilterCriterion | undefined): FilterColumnFormValues {
    if (initial?.type !== 'condition') return { op: 'eq', values: [{ value: '' }] }
    const { condition } = initial
    if (!('values' in condition) || condition.values.length === 0) {
        return { op: condition.op, values: [{ value: '' }] }
    }
    return { op: condition.op, values: condition.values.map(value => ({ value })) }
}

// toFilterCriterion turns parsed (already trimmed) form output into the
// criterion stored on the filter view. Blank rows are dropped.
export function toFilterCriterion(data: z.output<typeof filterColumnSchema>): FilterCriterion {
    const { op } = data
    if (op === 'isEmpty' || op === 'isNotEmpty') {
        return { type: 'condition', condition: { op } }
    }
    const values = data.values.map(v => v.value).filter(v => v.length > 0)
    return { type: 'condition', condition: { op, values } }
}
