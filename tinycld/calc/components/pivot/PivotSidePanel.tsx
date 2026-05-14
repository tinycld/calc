import { useMemo } from 'react'
import { X } from 'lucide-react-native'
import { Pressable, ScrollView, Switch, Text, View } from 'react-native'
import * as Y from 'yjs'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    addColumn,
    addFilter,
    addRow,
    addValue,
    moveField,
    removeField,
    setBoolean,
    setFilterSelection,
    setValueAggregation,
    setValueNumFmt,
} from '../../lib/pivot/mutate'
import type { PivotDefinition } from '../../lib/workbook-types'
import { FieldList } from './FieldList'
import { FieldRow } from './FieldRow'
import { FieldSlot } from './FieldSlot'
import { FilterFieldRow } from './FilterFieldRow'
import {
    canMoveDown,
    canMoveUp,
    readSourceMetadata,
} from './pivot-side-panel-helpers'
import { ValueFieldRow } from './ValueFieldRow'

// Side panel composer for editing a pivot definition. Lays out the
// source range readout, the FieldList of available source headers,
// four FieldSlots (Rows / Columns / Values / Filters), and the
// grand-totals / subtotals toggles. All mutations route through the
// `lib/pivot/mutate.ts` helpers so they ride the Y.Doc transaction
// origin used by the undo manager.
//
// The component itself owns no state — `def` comes in already
// reactive from the parent (usePivotForSheet), and `doc` is the live
// Y.Doc that every mutator writes to. `useMemo` on the source
// metadata is purely a perf nudge: the read walks O(rows * cols) of
// the source range to compute distinct filter values, and we don't
// want that on every keystroke into the numFmt TextInput. The deps
// list intentionally only watches def (sourceRange in particular) —
// edits to a cell value inside the source range still update the
// engine output through the engine path; the panel just needs to
// know the headers and distinct values, which change at the
// definition level.
//
// `readOnly` threads through to every child that accepts a
// `disabled` prop. The FieldList, FieldRow, ValueFieldRow,
// FilterFieldRow, and OptionToggle all already had `disabled`
// surfaces from earlier tasks — this is the wiring layer.
export interface PivotSidePanelProps {
    doc: Y.Doc
    def: PivotDefinition
    onClose: () => void
    readOnly?: boolean
}

export function PivotSidePanel({
    doc,
    def,
    onClose,
    readOnly,
}: PivotSidePanelProps) {
    const iconColor = useThemeColor('muted-foreground')
    const { headers, distinctByColumn } = useMemo(
        () => readSourceMetadata(doc, def),
        [doc, def]
    )

    return (
        <View className="w-[360px] flex-1 border-l border-border bg-background">
            <PanelHeader iconColor={iconColor} onClose={onClose} />
            <ScrollView className="flex-1 px-4 py-3">
                <Text className="text-xs font-medium uppercase text-muted-foreground">
                    Source
                </Text>
                <Text className="mt-1 text-sm text-foreground">
                    {def.sourceRange}
                </Text>

                <View className="mt-4">
                    <FieldList
                        headers={headers}
                        onAddRow={(c) => addRow(doc, def.id, c)}
                        onAddCol={(c) => addColumn(doc, def.id, c)}
                        onAddValue={(c) => addValue(doc, def.id, c, 'sum')}
                        onAddFilter={(c) => addFilter(doc, def.id, c)}
                        disabled={readOnly}
                    />
                </View>

                <FieldSlot label="Rows">
                    {def.rows.map((f, i) => (
                        <FieldRow
                            key={`${f.sourceColumn}:${i}`}
                            label={f.displayName ?? f.sourceColumn}
                            canMoveUp={canMoveUp(i)}
                            canMoveDown={canMoveDown(i, def.rows.length)}
                            onMoveUp={() =>
                                moveField(doc, def.id, 'rows', i, i - 1)
                            }
                            onMoveDown={() =>
                                moveField(doc, def.id, 'rows', i, i + 1)
                            }
                            onRemove={() =>
                                removeField(doc, def.id, 'rows', i)
                            }
                            disabled={readOnly}
                        />
                    ))}
                </FieldSlot>

                <FieldSlot label="Columns">
                    {def.cols.map((f, i) => (
                        <FieldRow
                            key={`${f.sourceColumn}:${i}`}
                            label={f.displayName ?? f.sourceColumn}
                            canMoveUp={canMoveUp(i)}
                            canMoveDown={canMoveDown(i, def.cols.length)}
                            onMoveUp={() =>
                                moveField(doc, def.id, 'cols', i, i - 1)
                            }
                            onMoveDown={() =>
                                moveField(doc, def.id, 'cols', i, i + 1)
                            }
                            onRemove={() =>
                                removeField(doc, def.id, 'cols', i)
                            }
                            disabled={readOnly}
                        />
                    ))}
                </FieldSlot>

                <FieldSlot label="Values">
                    {def.values.map((f, i) => (
                        <ValueFieldRow
                            key={`${f.sourceColumn}:${i}`}
                            field={f}
                            canMoveUp={canMoveUp(i)}
                            canMoveDown={canMoveDown(i, def.values.length)}
                            onMoveUp={() =>
                                moveField(doc, def.id, 'values', i, i - 1)
                            }
                            onMoveDown={() =>
                                moveField(doc, def.id, 'values', i, i + 1)
                            }
                            onRemove={() =>
                                removeField(doc, def.id, 'values', i)
                            }
                            onChangeAggregation={(agg) =>
                                setValueAggregation(doc, def.id, i, agg)
                            }
                            onChangeNumFmt={(fmt) =>
                                setValueNumFmt(doc, def.id, i, fmt)
                            }
                            disabled={readOnly}
                        />
                    ))}
                </FieldSlot>

                <FieldSlot label="Filters">
                    {def.filters.map((f, i) => (
                        <FilterFieldRow
                            key={`${f.sourceColumn}:${i}`}
                            column={f.sourceColumn}
                            selected={
                                def.filterSelections[f.sourceColumn] ?? []
                            }
                            distinctValues={
                                distinctByColumn[f.sourceColumn] ?? []
                            }
                            onChangeSelection={(next) =>
                                setFilterSelection(
                                    doc,
                                    def.id,
                                    f.sourceColumn,
                                    next
                                )
                            }
                            onRemove={() =>
                                removeField(doc, def.id, 'filters', i)
                            }
                            disabled={readOnly}
                        />
                    ))}
                </FieldSlot>

                <FieldSlot label="Options">
                    <OptionToggle
                        label="Row grand totals"
                        value={def.rowGrandTotals}
                        disabled={readOnly}
                        onChange={(v) =>
                            setBoolean(doc, def.id, 'rowGrandTotals', v)
                        }
                        accessibilityLabel="Toggle row grand totals"
                    />
                    <OptionToggle
                        label="Column grand totals"
                        value={def.colGrandTotals}
                        disabled={readOnly}
                        onChange={(v) =>
                            setBoolean(doc, def.id, 'colGrandTotals', v)
                        }
                        accessibilityLabel="Toggle column grand totals"
                    />
                    <OptionToggle
                        label="Row subtotals"
                        value={def.rowSubtotals}
                        disabled={readOnly}
                        onChange={(v) =>
                            setBoolean(doc, def.id, 'rowSubtotals', v)
                        }
                        accessibilityLabel="Toggle row subtotals"
                    />
                    <OptionToggle
                        label="Column subtotals"
                        value={def.colSubtotals}
                        disabled={readOnly}
                        onChange={(v) =>
                            setBoolean(doc, def.id, 'colSubtotals', v)
                        }
                        accessibilityLabel="Toggle column subtotals"
                    />
                </FieldSlot>
            </ScrollView>
        </View>
    )
}

interface PanelHeaderProps {
    iconColor: string
    onClose: () => void
}

function PanelHeader({ iconColor, onClose }: PanelHeaderProps) {
    return (
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <Text className="text-sm font-medium text-foreground">
                Pivot editor
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close pivot panel"
                onPress={onClose}
                className="rounded-md p-1"
            >
                <X size={16} color={iconColor} />
            </Pressable>
        </View>
    )
}

interface OptionToggleProps {
    label: string
    value: boolean
    disabled: boolean | undefined
    onChange: (next: boolean) => void
    accessibilityLabel: string
}

function OptionToggle({
    label,
    value,
    disabled,
    onChange,
    accessibilityLabel,
}: OptionToggleProps) {
    return (
        <View className="flex-row items-center justify-between">
            <Text className="text-sm text-foreground">{label}</Text>
            <Switch
                accessibilityLabel={accessibilityLabel}
                disabled={disabled}
                value={value}
                onValueChange={onChange}
            />
        </View>
    )
}
