import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    type Control,
    Controller,
    useFieldArray,
    useForm,
    useWatch,
    zodResolver,
} from '@tinycld/core/ui/form'
import { Plus, X } from 'lucide-react-native'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type * as Y from 'yjs'
import { useGridFilterControls } from '../../hooks/grid/use-grid-filter-controls'
import { useFilterView } from '../../hooks/use-filter-view'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import type { FilterCondition, FilterCriterion } from '../../lib/filter'
import { columnLabel } from '../../lib/workbook-types'
import {
    type FilterColumnFormValues,
    filterColumnDefaults,
    filterColumnSchema,
    opNeedsValues,
    toFilterCriterion,
} from './filter-column-schema'

interface FilterColumnDialogProps {
    doc: Y.Doc | null
    sheetId: string
}

const CONDITION_OPS: ReadonlyArray<{ op: FilterCondition['op']; label: string }> = [
    { op: 'eq', label: 'is equal to' },
    { op: 'neq', label: 'is not equal to' },
    { op: 'gt', label: 'is greater than' },
    { op: 'lt', label: 'is less than' },
    { op: 'contains', label: 'contains' },
    { op: 'startsWith', label: 'starts with' },
    { op: 'endsWith', label: 'ends with' },
    { op: 'isEmpty', label: 'is empty' },
    { op: 'isNotEmpty', label: 'is not empty' },
]

const NATIVE_HIT_SLOP = Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }

const PANEL_WIDTH = 360
// Sits above context menus / popovers (those land around 60).
const OVERLAY_ZINDEX = 80

// Outer gate: subscribes to filterDialogCol so the rest of Grid
// doesn't re-render on open/close. When non-null, remounts the inner
// editor with key={col} so opening on a different column re-seeds
// the form via remount.
export function FilterColumnDialog({ doc, sheetId }: FilterColumnDialogProps) {
    const col = useGridStore(s => s.filterDialogCol)
    if (col == null) return null
    return <FilterColumnDialogInner key={col} doc={doc} sheetId={sheetId} col={col} />
}

interface InnerProps {
    doc: Y.Doc | null
    sheetId: string
    col: number
}

function FilterColumnDialogInner({ doc, sheetId, col }: InnerProps) {
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeFilterDialog(), [store])
    const fg = useThemeColor('foreground')
    const panelRef = useRef<View | null>(null)

    const view = useFilterView(doc, sheetId)
    const { applyHeaderCriterion, removeHeaderCriterion } = useGridFilterControls({
        doc,
        sheetId,
        store,
    })

    // Snapshot the existing criterion at mount so peer changes (or our
    // own apply) don't fight the user's in-progress edits. The dialog
    // remounts with key={col} when the user opens a different column,
    // so this snapshot is always for the current column. Only
    // condition-shaped criteria are editable here — values-style ones
    // come from Flow 1.
    const initialRef = useRef<FilterCriterion | undefined>(view?.criteria[col])
    const initial = initialRef.current
    const isEditing = initial?.type === 'condition'

    const {
        control,
        handleSubmit,
        formState: { isValid },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(filterColumnSchema),
        defaultValues: filterColumnDefaults(initial),
    })
    const values = useFieldArray({ control, name: 'values' })
    const op = useWatch({ control, name: 'op' })
    const needsValues = opNeedsValues(op)
    const applyDisabled = !isValid

    const onApply = handleSubmit(data => {
        applyHeaderCriterion(col, toFilterCriterion(data))
        onClose()
    })

    const onRemove = useCallback(() => {
        removeHeaderCriterion(col)
        onClose()
    }, [removeHeaderCriterion, col, onClose])

    // Web outside-click dismissal — same pattern as CellContextMenu.
    // Defer attach so the click that opened the dialog doesn't
    // immediately close it.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        let detach: (() => void) | null = null
        const t = setTimeout(() => {
            const handler = (event: PointerEvent) => {
                const targetNode = event.target as Node | null
                const node = panelRef.current as unknown as Node | null
                if (targetNode && node?.contains(targetNode)) return
                onClose()
            }
            document.addEventListener('pointerdown', handler, true)
            detach = () => document.removeEventListener('pointerdown', handler, true)
        }, 0)
        return () => {
            clearTimeout(t)
            detach?.()
        }
    }, [onClose])

    return (
        <View
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                zIndex: OVERLAY_ZINDEX,
            }}
            pointerEvents="box-none"
        >
            {Platform.OS !== 'web' && (
                <Pressable
                    onPress={onClose}
                    accessibilityLabel="Close filter dialog"
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.25)',
                    }}
                />
            )}
            <View
                style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16,
                }}
                pointerEvents="box-none"
            >
                <View
                    ref={panelRef}
                    accessibilityLabel={`Filter column ${columnLabel(col)}`}
                    className="bg-background border border-border rounded-lg"
                    style={{
                        width: PANEL_WIDTH,
                        maxWidth: '100%',
                        padding: 12,
                        ...(Platform.OS === 'web'
                            ? ({ boxShadow: '0 8px 24px rgba(0,0,0,0.18)' } as object)
                            : {
                                  elevation: 8,
                                  shadowColor: '#000',
                                  shadowOffset: { width: 0, height: 4 },
                                  shadowOpacity: 0.18,
                                  shadowRadius: 12,
                              }),
                    }}
                >
                    <View
                        className="flex-row items-center justify-between"
                        style={{ marginBottom: 8 }}
                    >
                        <Text
                            className="text-foreground"
                            style={{ fontSize: 14, fontWeight: '600' }}
                        >
                            Filter column {columnLabel(col)}
                        </Text>
                        <Pressable
                            onPress={onClose}
                            accessibilityLabel="Close"
                            accessibilityRole="button"
                            hitSlop={NATIVE_HIT_SLOP}
                            style={{
                                width: 22,
                                height: 22,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 4,
                            }}
                        >
                            <X size={16} color={fg} />
                        </Pressable>
                    </View>

                    <Controller
                        control={control}
                        name="op"
                        render={({ field }) => (
                            <ConditionOpList value={field.value} onChange={field.onChange} />
                        )}
                    />

                    <FilterValueRows
                        isVisible={needsValues}
                        control={control}
                        fields={values.fields}
                        onAdd={() => values.append({ value: '' })}
                        onRemove={values.remove}
                    />

                    <View
                        className="flex-row items-center justify-between"
                        style={{ marginTop: 4 }}
                    >
                        <View className="flex-row items-center" style={{ gap: 6 }}>
                            {isEditing ? (
                                <Pressable
                                    onPress={onRemove}
                                    accessibilityLabel="Remove filter"
                                    accessibilityRole="button"
                                    className="rounded border border-border"
                                    style={{ paddingHorizontal: 12, paddingVertical: 6 }}
                                >
                                    <Text className="text-danger" style={{ fontSize: 13 }}>
                                        Remove
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                        <View className="flex-row items-center" style={{ gap: 6 }}>
                            <Pressable
                                onPress={onClose}
                                accessibilityLabel="Cancel"
                                accessibilityRole="button"
                                className="rounded border border-border"
                                style={{ paddingHorizontal: 12, paddingVertical: 6 }}
                            >
                                <Text className="text-foreground" style={{ fontSize: 13 }}>
                                    Cancel
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={onApply}
                                disabled={applyDisabled}
                                accessibilityLabel="Apply"
                                accessibilityRole="button"
                                accessibilityState={{ disabled: applyDisabled }}
                                className={`rounded ${applyDisabled ? 'bg-muted' : 'bg-accent'}`}
                                style={{ paddingHorizontal: 12, paddingVertical: 6 }}
                            >
                                <Text
                                    className={
                                        applyDisabled
                                            ? 'text-muted-foreground'
                                            : 'text-accent-foreground'
                                    }
                                    style={{ fontSize: 13 }}
                                >
                                    Apply
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </View>
        </View>
    )
}

function ConditionOpList({
    value,
    onChange,
}: {
    value: FilterCondition['op']
    onChange: (op: FilterCondition['op']) => void
}) {
    return (
        <ScrollView
            style={{ maxHeight: 200, marginBottom: 8 }}
            className="border border-border rounded"
        >
            {CONDITION_OPS.map(option => (
                <ConditionOpRow
                    key={option.op}
                    label={option.label}
                    isActive={option.op === value}
                    onPress={() => onChange(option.op)}
                />
            ))}
        </ScrollView>
    )
}

function ConditionOpRow({
    label,
    isActive,
    onPress,
}: {
    label: string
    isActive: boolean
    onPress: () => void
}) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            className={`px-3 py-2 ${isActive ? 'bg-accent' : ''}`}
        >
            <Text
                className={isActive ? 'text-accent-foreground' : 'text-foreground'}
                style={{ fontSize: 13 }}
            >
                {label}
            </Text>
        </Pressable>
    )
}

interface FilterValueRowsProps {
    isVisible: boolean
    control: Control<FilterColumnFormValues>
    fields: { id: string }[]
    onAdd: () => void
    onRemove: (idx: number) => void
}

function FilterValueRows({ isVisible, control, fields, onAdd, onRemove }: FilterValueRowsProps) {
    const fg = useThemeColor('foreground')
    if (!isVisible) return null
    return (
        <View style={{ marginBottom: 8, gap: 6 }}>
            {fields.map((row, idx) => (
                <FilterValueRow key={row.id} control={control} idx={idx} onRemove={onRemove} />
            ))}
            <Pressable
                onPress={onAdd}
                accessibilityLabel="Add value"
                accessibilityRole="button"
                hitSlop={NATIVE_HIT_SLOP}
                className="flex-row items-center rounded border border-border self-start"
                style={{ gap: 4, paddingHorizontal: 8, paddingVertical: 4 }}
            >
                <Plus size={12} color={fg} />
                <Text className="text-foreground" style={{ fontSize: 12 }}>
                    Add value
                </Text>
            </Pressable>
        </View>
    )
}

interface FilterValueRowProps {
    control: Control<FilterColumnFormValues>
    idx: number
    onRemove: (idx: number) => void
}

function FilterValueRow({ control, idx, onRemove }: FilterValueRowProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    return (
        <View className="flex-row items-center" style={{ gap: 6 }}>
            <Controller
                control={control}
                name={`values.${idx}.value`}
                render={({ field }) => (
                    <TextInput
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        placeholder="Value"
                        placeholderTextColor={muted}
                        accessibilityLabel={`Filter value ${idx + 1}`}
                        className="flex-1 rounded border border-border bg-surface-secondary"
                        style={{
                            height: 28,
                            paddingHorizontal: 8,
                            fontSize: 13,
                            color: fg,
                        }}
                    />
                )}
            />
            <RemoveValueButton isVisible={idx > 0} idx={idx} onRemove={onRemove} />
        </View>
    )
}

function RemoveValueButton({
    isVisible,
    idx,
    onRemove,
}: {
    isVisible: boolean
    idx: number
    onRemove: (idx: number) => void
}) {
    const fg = useThemeColor('foreground')
    if (!isVisible) return null
    return (
        <Pressable
            onPress={() => onRemove(idx)}
            accessibilityLabel={`Remove value ${idx + 1}`}
            accessibilityRole="button"
            hitSlop={NATIVE_HIT_SLOP}
            style={{
                width: 24,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
            }}
        >
            <X size={14} color={fg} />
        </Pressable>
    )
}
