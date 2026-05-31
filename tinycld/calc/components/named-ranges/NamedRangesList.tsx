import { Button, ButtonText } from '@tinycld/core/ui/button'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type * as Y from 'yjs'
import {
    type NamedRangeEntry,
    useNamedRangeMutations,
    useNamedRangePreview,
    useNamedRanges,
} from '../../hooks/use-named-ranges'
import { useAllYSheets } from '../../hooks/use-y-sheets'
import type { NamedRangeKey } from '../../lib/named-ranges/types'

export interface NamedRangesListProps {
    doc: Y.Doc | null
    onEdit: (key: NamedRangeKey) => void
    onCreate: () => void
}

// NamedRangesList renders the table of currently-defined names with
// edit / delete actions per row. The new-name button at the top right
// kicks the dialog into edit mode (create variant).
export function NamedRangesList({ doc, onEdit, onCreate }: NamedRangesListProps) {
    const ranges = useNamedRanges(doc)
    const sheets = useAllYSheets(doc)
    const mutations = useNamedRangeMutations(doc)
    const [pendingDelete, setPendingDelete] = useState<NamedRangeKey | null>(null)

    const sheetNameById = useCallback(
        (id: string): string => sheets.find(s => s.id === id)?.name ?? id,
        [sheets]
    )

    const confirmDelete = useCallback(
        (key: NamedRangeKey) => {
            mutations.remove(key)
            setPendingDelete(null)
        },
        [mutations]
    )

    return (
        <View className="flex-1">
            <View className="flex-row items-center justify-between px-5 py-3">
                <Text className="text-xs text-muted-foreground">
                    {ranges.length} {ranges.length === 1 ? 'name' : 'names'} defined
                </Text>
                <Button onPress={onCreate} size="sm">
                    <ButtonText>Add name</ButtonText>
                </Button>
            </View>

            {ranges.length === 0 ? (
                <View className="px-5 py-8 items-center">
                    <Text className="text-sm text-muted-foreground text-center">
                        No named ranges yet. Add one to give a meaningful label to a cell, a range,
                        or a constant.
                    </Text>
                </View>
            ) : (
                <ScrollView className="max-h-[440px]">
                    {ranges.map(entry => (
                        <NamedRangeRow
                            key={entry.key}
                            doc={doc}
                            entry={entry}
                            scopeLabel={
                                entry.range.scope == null
                                    ? 'Workbook'
                                    : sheetNameById(entry.range.scope)
                            }
                            ticker={ranges}
                            onEdit={() => onEdit(entry.key)}
                            onAskDelete={() => setPendingDelete(entry.key)}
                            confirmingDelete={pendingDelete === entry.key}
                            onConfirmDelete={() => confirmDelete(entry.key)}
                            onCancelDelete={() => setPendingDelete(null)}
                        />
                    ))}
                </ScrollView>
            )}
        </View>
    )
}

interface NamedRangeRowProps {
    doc: Y.Doc | null
    entry: NamedRangeEntry
    scopeLabel: string
    // Identity ticker — any token whose identity changes when the
    // named-range list changes. Passed straight through to
    // useNamedRangePreview so the row's preview refreshes when an
    // upstream cell mutates.
    ticker: unknown
    onEdit: () => void
    onAskDelete: () => void
    confirmingDelete: boolean
    onConfirmDelete: () => void
    onCancelDelete: () => void
}

function NamedRangeRow({
    doc,
    entry,
    scopeLabel,
    ticker,
    onEdit,
    onAskDelete,
    confirmingDelete,
    onConfirmDelete,
    onCancelDelete,
}: NamedRangeRowProps) {
    const previewValue = useNamedRangePreview(doc, entry.range.name, entry.range.scope, ticker)
    const previewLabel = formatPreview(previewValue)

    return (
        <View className="px-5 py-2 border-t border-border">
            <View className="flex-row items-start gap-3">
                <View className="flex-1 gap-0.5">
                    <Text className="text-sm font-medium text-foreground">{entry.range.name}</Text>
                    <Text
                        className="text-[11px] text-muted-foreground"
                        numberOfLines={1}
                        style={{ fontFamily: 'monospace' }}
                    >
                        {entry.range.expression}
                    </Text>
                    <Text className="text-[10px] text-muted-foreground">
                        Scope: {scopeLabel}
                        {previewLabel !== '' ? `  ·  = ${previewLabel}` : ''}
                    </Text>
                    {entry.range.comment != null && entry.range.comment !== '' ? (
                        <Text className="text-[11px] text-foreground">{entry.range.comment}</Text>
                    ) : null}
                </View>
                {confirmingDelete ? (
                    <View className="flex-row items-center gap-1">
                        <Pressable onPress={onCancelDelete} className="px-2 py-1">
                            <Text className="text-xs text-foreground">Cancel</Text>
                        </Pressable>
                        <Pressable
                            onPress={onConfirmDelete}
                            className="px-2 py-1 rounded bg-destructive"
                            accessibilityLabel={`Confirm delete ${entry.range.name}`}
                        >
                            <Text className="text-xs text-destructive-foreground">Delete</Text>
                        </Pressable>
                    </View>
                ) : (
                    <View className="flex-row items-center gap-1">
                        <Pressable
                            onPress={onEdit}
                            className="px-2 py-1"
                            accessibilityLabel={`Edit ${entry.range.name}`}
                        >
                            <Text className="text-xs text-foreground">Edit</Text>
                        </Pressable>
                        <Pressable
                            onPress={onAskDelete}
                            className="px-2 py-1"
                            accessibilityLabel={`Delete ${entry.range.name}`}
                        >
                            <Text className="text-xs text-destructive">Delete</Text>
                        </Pressable>
                    </View>
                )}
            </View>
        </View>
    )
}

// formatPreview shapes a raw HF value into a short, human-readable
// label for the row preview. HF returns numbers / strings / booleans
// for scalars; ranges resolve to the upper-left cell's value (HF
// convention) which is good enough for an at-a-glance preview.
function formatPreview(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value === 'object' && value != null && 'value' in value) {
        // DetailedCellError shape.
        return String((value as { value: string }).value ?? '')
    }
    return ''
}
