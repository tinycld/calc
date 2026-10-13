// One-rule authoring form. Owns the form draft for the rule the
// user is currently editing (controlled by the parent's editingRuleId
// keying — when the key changes, this remounts with a fresh draft).
//
// The condition type dropdown is grouped by family
// (Text / Number / Date / Empty / Custom formula). Operand inputs
// render conditionally based on the selected type. The style picker
// is inline — bold/italic/underline/strike toggles + two color
// swatches.
//
// The Cancel / Done buttons render in the Drawer footer, not in this
// component, so they stay anchored at the bottom of the panel while
// the form fields scroll. The parent panel calls back into this
// component via a ref handle (see RuleEditorHandle) when the user
// submits, since the draft lives here.

import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { type Control, Controller, useForm, useWatch, zodResolver } from '@tinycld/core/ui/form'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { forwardRef, useImperativeHandle } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { CFConditionType, CFRule } from '../../lib/conditional-format/types'
import type { CellFont } from '../../lib/workbook-types'
import { ConditionTypePicker } from './ConditionTypePicker'
import {
    operandCount,
    type RuleEditorFormValues,
    type RuleEditorOutput,
    ruleEditorDefaults,
    ruleEditorSchema,
    toRule,
} from './rule-schema'
import { StylePicker } from './StylePicker'

export interface RuleEditorProps {
    rule: CFRule
    readOnly?: boolean
}

// RuleEditorHandle exposes the form's submit to the parent panel. The
// footer Done button calls submit(onValid) — the editor validates its
// draft and, only when it is valid, hands the assembled CFRule to
// onValid. Invalid drafts stay open with their field errors shown. The
// editor never imports the parent's save callback so the form keeps
// owning the data flow's local state.
export interface RuleEditorHandle {
    submit(onValid: (rule: CFRule) => void): Promise<void>
}

export const RuleEditor = forwardRef<RuleEditorHandle, RuleEditorProps>(function RuleEditor(
    { rule, readOnly },
    ref
) {
    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(ruleEditorSchema),
        defaultValues: ruleEditorDefaults(rule),
    })

    useImperativeHandle(
        ref,
        () => ({
            submit: onValid => handleSubmit(data => onValid(toRule(rule, data)))(),
        }),
        [handleSubmit, rule]
    )

    const conditionType = useWatch({ control, name: 'conditionType' })
    const opCount = operandCount(conditionType)
    const isFormula = conditionType === 'customFormula'

    return (
        <View>
            <FieldLabel>Apply to range</FieldLabel>
            <Controller
                control={control}
                name="ranges"
                render={({ field }) => (
                    <PlainInput
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        editable={!readOnly}
                        placeholder="A1:A100"
                        className={INPUT_CLASS}
                    />
                )}
            />
            <FieldError message={errors.ranges?.message} />

            <FieldLabel>Format cells if…</FieldLabel>
            <Controller
                control={control}
                name="conditionType"
                render={({ field }) => (
                    <ConditionTypePicker
                        value={field.value}
                        onChange={field.onChange}
                        disabled={readOnly}
                    />
                )}
            />

            <OperandField
                isVisible={opCount >= 1 && !isFormula}
                control={control}
                name="value1"
                label={opCount === 2 ? 'Value (start)' : 'Value'}
                placeholder={placeholderFor(conditionType)}
                readOnly={readOnly}
                error={errors.value1?.message}
            />
            <OperandField
                isVisible={opCount === 2}
                control={control}
                name="value2"
                label="Value (end)"
                placeholder={placeholderFor(conditionType)}
                readOnly={readOnly}
                error={errors.value2?.message}
            />
            <FormulaField
                isVisible={isFormula}
                control={control}
                readOnly={readOnly}
                error={errors.formula?.message}
            />

            <FieldLabel>Formatting style</FieldLabel>
            <Controller
                control={control}
                name="style"
                render={({ field }) => (
                    <StylePicker
                        style={field.value}
                        onChange={field.onChange}
                        disabled={readOnly}
                    />
                )}
            />
        </View>
    )
})

type RuleEditorControl = Control<RuleEditorFormValues, unknown, RuleEditorOutput>

const INPUT_CLASS = 'rounded border border-border bg-background px-2 py-1 text-sm text-foreground'

interface OperandFieldProps {
    isVisible: boolean
    control: RuleEditorControl
    name: 'value1' | 'value2'
    label: string
    placeholder: string
    readOnly: boolean | undefined
    error: string | undefined
}

function OperandField({
    isVisible,
    control,
    name,
    label,
    placeholder,
    readOnly,
    error,
}: OperandFieldProps) {
    if (!isVisible) return null
    return (
        <>
            <FieldLabel>{label}</FieldLabel>
            <Controller
                control={control}
                name={name}
                render={({ field }) => (
                    <PlainInput
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        editable={!readOnly}
                        placeholder={placeholder}
                        className={INPUT_CLASS}
                    />
                )}
            />
            <FieldError message={error} />
        </>
    )
}

interface FormulaFieldProps {
    isVisible: boolean
    control: RuleEditorControl
    readOnly: boolean | undefined
    error: string | undefined
}

function FormulaField({ isVisible, control, readOnly, error }: FormulaFieldProps) {
    if (!isVisible) return null
    return (
        <>
            <FieldLabel>Formula</FieldLabel>
            <View className="flex-row items-center gap-1">
                <Text className="text-sm text-muted-foreground">=</Text>
                <Controller
                    control={control}
                    name="formula"
                    render={({ field }) => (
                        <PlainInput
                            value={field.value}
                            onChangeText={field.onChange}
                            onBlur={field.onBlur}
                            editable={!readOnly}
                            placeholder="$A1>10"
                            className={`flex-1 ${INPUT_CLASS}`}
                        />
                    )}
                />
            </View>
            <FieldError message={error} />
        </>
    )
}

function FieldError({ message }: { message: string | undefined }) {
    if (message == null) return null
    return <Text className="mt-1 text-xs text-destructive">{message}</Text>
}

// Editor action buttons rendered into the Drawer footer by the parent
// panel so they stay anchored at the bottom of the drawer while the
// form body scrolls. The parent supplies the click handlers; this
// component is a pure layout for the two buttons.
export function RuleEditorActions({
    onCancel,
    onDone,
    disabled,
}: {
    onCancel: () => void
    onDone: () => void
    disabled?: boolean
}) {
    return (
        <View className="flex-row justify-end gap-2">
            <ButtonGhost onPress={onCancel} label="Cancel" />
            <ButtonPrimary onPress={onDone} label="Done" disabled={disabled} />
        </View>
    )
}

function FieldLabel({ children }: { children: string }) {
    return (
        <Text className="mt-3 mb-1 text-xs font-medium uppercase text-muted-foreground">
            {children}
        </Text>
    )
}

function ButtonGhost({ onPress, label }: { onPress: () => void; label: string }) {
    return (
        <Pressable
            onPress={onPress}
            className="rounded border border-border px-3 py-1.5"
            accessibilityLabel={label}
        >
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}

function ButtonPrimary({
    onPress,
    label,
    disabled,
}: {
    onPress: () => void
    label: string
    disabled?: boolean
}) {
    const bg = useThemeColor('accent')
    const fg = useThemeColor('accent-foreground')
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            className="rounded px-3 py-1.5"
            style={{ backgroundColor: bg, opacity: disabled ? 0.5 : 1 }}
            accessibilityLabel={label}
        >
            <Text style={{ color: fg, fontSize: 14 }}>{label}</Text>
        </Pressable>
    )
}

function placeholderFor(type: CFConditionType): string {
    if (type.startsWith('date')) return 'YYYY-MM-DD'
    if (type.startsWith('number')) return '0'
    return 'text'
}

// Re-export for tests / external use of the no-op marker (e.g. when
// callers construct a draft style and want to preserve the font sub-
// type's shape). Not used here.
export type RuleEditorFontStyle = CellFont
