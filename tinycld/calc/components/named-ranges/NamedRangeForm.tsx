import { Button, ButtonText } from '@tinycld/core/ui/button'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { type NamedRangeMutations, useNamedRangeMutations } from '../../hooks/use-named-ranges'
import { useAllYSheets } from '../../hooks/use-y-sheets'
import { getFormulaBridge } from '../../lib/formula/bridge'
import type { NamedRange, NamedRangeKey } from '../../lib/named-ranges/types'
import { validateName } from '../../lib/named-ranges/y-binding'

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
// range and owns local draft state. It delegates persistence to
// useNamedRangeMutations and surfaces validation / HF rejection as
// inline field errors instead of throwing.
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
    const mutations = useNamedRangeMutations(doc)

    const [name, setName] = useState<string>(initial?.range.name ?? prefillName ?? '')
    const [expression, setExpression] = useState<string>(
        initial?.range.expression ?? prefillExpression ?? ''
    )
    const [scope, setScope] = useState<string | null>(
        initial?.range.scope ?? (prefillScope === undefined ? null : prefillScope)
    )
    const [comment, setComment] = useState<string>(initial?.range.comment ?? '')
    const [error, setError] = useState<string | null>(null)

    const onSubmit = useCallback(() => {
        const result = submit({
            doc,
            initial,
            mutations,
            input: { name, expression, scope, comment: comment.trim() || undefined },
        })
        if (result.ok) {
            onSaved()
        } else {
            setError(result.reason)
        }
    }, [doc, initial, mutations, name, expression, scope, comment, onSaved])

    const isSubmittable = useMemo(() => {
        if (name.trim() === '') return false
        if (expression.trim() === '') return false
        return true
    }, [name, expression])

    return (
        <View className="px-5 py-4 gap-3">
            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">Name</Text>
                <PlainInput
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. TaxRate"
                    className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                    accessibilityLabel="Name"
                />
            </View>

            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">Scope</Text>
                <View className="flex-row flex-wrap gap-2">
                    <ScopeChip
                        label="Workbook"
                        isActive={scope == null}
                        onPress={() => setScope(null)}
                    />
                    {sheets.map(s => (
                        <ScopeChip
                            key={s.id}
                            label={s.name}
                            isActive={scope === s.id}
                            onPress={() => setScope(s.id)}
                        />
                    ))}
                </View>
            </View>

            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">
                    Expression or value
                </Text>
                <PlainInput
                    value={expression}
                    onChangeText={setExpression}
                    placeholder="=Sheet1!$A$1:$A$10  or  =0.085"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                    accessibilityLabel="Expression"
                />
                <Text className="text-[10px] text-muted-foreground">
                    Use absolute references (e.g. $A$1:$A$10). Leading "=" is optional.
                </Text>
            </View>

            <View className="gap-1">
                <Text className="text-xs font-medium text-muted-foreground">
                    Description (optional)
                </Text>
                <PlainInput
                    value={comment}
                    onChangeText={setComment}
                    placeholder="What this name represents"
                    className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                    accessibilityLabel="Description"
                />
            </View>

            {error != null ? <Text className="text-xs text-destructive">{error}</Text> : null}

            <View className="flex-row items-center justify-end gap-2 pt-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={onCancel}
                    className="px-3 py-2 rounded-md"
                >
                    <Text className="text-sm text-foreground">Cancel</Text>
                </Pressable>
                <Button onPress={onSubmit} isDisabled={!isSubmittable} size="sm">
                    <ButtonText>{initial == null ? 'Create' : 'Save'}</ButtonText>
                </Button>
            </View>
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

interface SubmitArgs {
    doc: Y.Doc | null
    initial: NamedRangeFormProps['initial']
    mutations: NamedRangeMutations
    input: NamedRange
}

// submit runs name + expression validation, then dispatches to create /
// update. Returns the same shape the mutations return.
function submit({
    doc,
    initial,
    mutations,
    input,
}: SubmitArgs): { ok: true } | { ok: false; reason: string } {
    const trimmedName = input.name.trim()
    const nameCheck = validateName(trimmedName)
    if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason }

    const trimmedExpression = input.expression.trim()
    if (trimmedExpression === '') {
        return { ok: false, reason: 'Expression cannot be empty.' }
    }

    // Constants (e.g. `0.085`, `Quarterly`) are legal — they don't
    // start with `=`. Only validate via HF when the user provided
    // a formula.
    if (trimmedExpression.startsWith('=') && doc != null) {
        const bridge = getFormulaBridge(doc)
        if (bridge != null && !bridge.validateFormula(trimmedExpression)) {
            return { ok: false, reason: 'Expression is not a valid formula.' }
        }
    }

    const next: NamedRange = {
        name: trimmedName,
        expression: trimmedExpression,
        scope: input.scope,
        comment: input.comment,
    }

    if (initial == null) {
        return mutations.create(next)
    }
    return mutations.update(initial.key, next)
}
