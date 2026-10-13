import { z } from '@tinycld/core/ui/form'
import { validateName } from '../../lib/named-ranges/y-binding'

// Returns true when the formula engine accepts the formula. The form
// passes a lookup rather than the bridge itself because the bridge for a
// doc can register after the form mounts.
export type FormulaValidator = (formula: string) => boolean

// namedRangeSchemaFor builds the Name Manager form schema. Constants
// (e.g. `0.085`, `Quarterly`) are legal expressions — only input that
// starts with `=` goes through the formula engine.
export function namedRangeSchemaFor(validateFormula: FormulaValidator) {
    return z.object({
        name: z
            .string()
            .trim()
            .superRefine((name, ctx) => {
                const check = validateName(name)
                if (!check.ok) ctx.addIssue({ code: 'custom', message: check.reason })
            }),
        expression: z
            .string()
            .trim()
            .min(1, 'Expression cannot be empty.')
            .refine(expr => !expr.startsWith('=') || validateFormula(expr), {
                message: 'Expression is not a valid formula.',
            }),
        scope: z.string().nullable(),
        comment: z.string().trim(),
    })
}

export type NamedRangeFormValues = z.input<ReturnType<typeof namedRangeSchemaFor>>
