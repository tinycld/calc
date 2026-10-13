import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Controller, useForm, zodResolver } from '@tinycld/core/ui/form'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { useNamedRangeMutations } from '../../hooks/use-named-ranges'
import { useAllYSheets } from '../../hooks/use-y-sheets'
import { getFormulaBridge } from '../../lib/formula/bridge'
import type { NamedRange, NamedRangeKey } from '../../lib/named-ranges/types'
import { type FormulaValidator, namedRangeSchemaFor } from './named-range-schema'

export interface NamedRangeFormProps {
    doc: Y.Doc | null
    // Existing entry (when editing) — the form pre-fills from this and
    // routes the submit through `update`. Null for create mode.
    initial: { key: NamedRangeKey; range: NamedRange } | null
    // Prefill values used when opening the form from a shortcut path
    // (Name Box "type a name", context-menu "Define from selection",
    // etc.). Ignored when `initial` is set.
    prefillName?: string | null
    prefillExpression?: string | null
    prefillScope?: string | null
    onSaved: () => void
    onCancel: () => void
}

// NamedRangeForm renders the create/edit fields for a single named
// range. It delegates persistence to useNamedRangeMutations and surfaces
// validation / HF rejection as inline field errors instead of throwing.
export function NamedRangeForm({
    doc,
    initial,
    prefillName,
    prefillExpression,
    prefillScope,
    onSaved,
    onCancel,
}: NamedRangeFormProps) {
    const sheets = useAllYSheets(doc)
    const { control, errors, isValid, onSubmit } = useNamedRangeForm({
        doc,
        initial,
        prefillName,
        prefillExpression,
        prefillScope,
        onSaved,
    })

    return (
        <View className="px-5 py-4 gap-3">
            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">Name</Text>
                <Controller
                    control={control}
                    name="name"
                    render={({ field }) => (
                        <PlainInput
                            value={field.value}
                            onChangeText={field.onChange}
                            onBlur={field.onBlur}
                            placeholder="e.g. TaxRate"
                            className={INPUT_CLASS}
                            accessibilityLabel="Name"
                        />
                    )}
                />
                <FieldError message={errors.name?.message} />
            </View>

            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">Scope</Text>
                <Controller
                    control={control}
                    name="scope"
                    render={({ field }) => (
                        <ScopeChips sheets={sheets} value={field.value} onChange={field.onChange} />
                    )}
                />
            </View>

            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">
                    Expression or value
                </Text>
                <Controller
                    control={control}
                    name="expression"
                    render={({ field }) => (
                        <PlainInput
                            value={field.value}
                            onChangeText={field.onChange}
                            onBlur={field.onBlur}
                            placeholder="=Sheet1!$A$1:$A$10  or  =0.085"
                            autoCapitalize="none"
                            autoCorrect={false}
                            className={INPUT_CLASS}
                            accessibilityLabel="Expression"
                        />
                    )}
                />
                <Text className="text-[10px] text-muted-foreground">
                    Use absolute references (e.g. $A$1:$A$10). Leading "=" is optional.
                </Text>
                <FieldError message={errors.expression?.message} />
            </View>

            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">
                    Description (optional)
                </Text>
                <Controller
                    control={control}
                    name="comment"
                    render={({ field }) => (
                        <PlainInput
                            value={field.value}
                            onChangeText={field.onChange}
                            onBlur={field.onBlur}
                            placeholder="What this name represents"
                            className={INPUT_CLASS}
                            accessibilityLabel="Description"
                        />
                    )}
                />
            </View>

            <View className="flex-row items-center justify-end gap-2 pt-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={onCancel}
                    className="px-3 py-2 rounded-md"
                >
                    <Text className="text-sm text-foreground">Cancel</Text>
                </Pressable>
                <Button onPress={onSubmit} isDisabled={!isValid} size="sm">
                    <ButtonText>{initial == null ? 'Create' : 'Save'}</ButtonText>
                </Button>
            </View>
        </View>
    )
}

const INPUT_CLASS = 'rounded border border-border bg-background px-2 py-1 text-sm text-foreground'

type UseNamedRangeFormArgs = Omit<NamedRangeFormProps, 'onCancel'>

// useNamedRangeForm owns the draft. Shape rules (name syntax, non-empty
// expression, formula parse) live in the schema; only the uniqueness check,
// which needs the current Y.Doc contents, comes back from the mutation.
function useNamedRangeForm({
    doc,
    initial,
    prefillName,
    prefillExpression,
    prefillScope,
    onSaved,
}: UseNamedRangeFormArgs) {
    const mutations = useNamedRangeMutations(doc)
    const schema = useMemo(() => namedRangeSchemaFor(formulaValidatorFor(doc)), [doc])
    const {
        control,
        handleSubmit,
        setError,
        formState: { errors, isValid },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(schema),
        defaultValues: {
            name: initial?.range.name ?? prefillName ?? '',
            expression: initial?.range.expression ?? prefillExpression ?? '',
            scope: initial?.range.scope ?? prefillScope ?? null,
            comment: initial?.range.comment ?? '',
        },
    })

    const onSubmit = handleSubmit(data => {
        const next: NamedRange = {
            name: data.name,
            expression: data.expression,
            scope: data.scope,
            comment: data.comment || undefined,
        }
        const result =
            initial == null ? mutations.create(next) : mutations.update(initial.key, next)
        if (result.ok) {
            onSaved()
            return
        }
        setError('name', { message: result.reason })
    })

    return { control, errors, isValid, onSubmit }
}

// The bridge is looked up per call: it registers for a doc once the
// workbook finishes loading, which can happen after the form mounts.
function formulaValidatorFor(doc: Y.Doc | null): FormulaValidator {
    return formula => {
        if (doc == null) return true
        const bridge = getFormulaBridge(doc)
        return bridge == null || bridge.validateFormula(formula)
    }
}

function FieldError({ message }: { message: string | undefined }) {
    if (message == null) return null
    return <Text className="text-xs text-destructive">{message}</Text>
}

interface ScopeChipsProps {
    sheets: { id: string; name: string }[]
    value: string | null
    onChange: (scope: string | null) => void
}

function ScopeChips({ sheets, value, onChange }: ScopeChipsProps) {
    return (
        <View className="flex-row flex-wrap gap-2">
            <ScopeChip label="Workbook" isActive={value == null} onPress={() => onChange(null)} />
            {sheets.map(s => (
                <ScopeChip
                    key={s.id}
                    label={s.name}
                    isActive={value === s.id}
                    onPress={() => onChange(s.id)}
                />
            ))}
        </View>
    )
}

interface ScopeChipProps {
    label: string
    isActive: boolean
    onPress: () => void
}

function ScopeChip({ label, isActive, onPress }: ScopeChipProps) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`Scope ${label}`}
            onPress={onPress}
            className={
                isActive
                    ? 'px-3 py-1 rounded-md bg-accent'
                    : 'px-3 py-1 rounded-md bg-surface-secondary'
            }
        >
            <Text
                className={isActive ? 'text-xs text-accent-foreground' : 'text-xs text-foreground'}
            >
                {label}
            </Text>
        </Pressable>
    )
}
