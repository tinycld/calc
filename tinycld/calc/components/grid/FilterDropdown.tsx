import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dimensions, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type * as Y from 'yjs'
import { useFilterView } from '../../hooks/use-filter-view'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import {
    applyFilter,
    clearFilter,
    distinctValuesForColumn,
    type FilterCondition,
    type FilterCriterion,
} from '../../lib/filter'
import { columnLabel } from '../../lib/workbook-types'

interface FilterDropdownProps {
    doc: Y.Doc | null
    sheetId: string
    // Window-coordinate rect of the column header that owns this
    // dropdown. The dropdown anchors below the header's bottom-left.
    anchorRect: { left: number; top: number; width: number; height: number } | null
}

type Tab = 'values' | 'condition'

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

// Popover dropdown anchored to a column header. Two tabs: Values (a
// checkbox list of distinct cell displays) and Condition (an op picker
// + value input). Apply persists onto sheet metadata via
// applyFilter; Clear removes the filter view entirely.
export function FilterDropdown({ doc, sheetId, anchorRect }: FilterDropdownProps) {
    const filterDropdownCol = useGridStore(s => s.filterDropdownCol)
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeFilterDropdown(), [store])

    const fg = useThemeColor('foreground')
    const panelRef = useRef<View | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)

    const view = useFilterView(doc, sheetId)

    const distinct = useMemo(() => {
        if (doc == null || view == null || filterDropdownCol == null) return [] as string[]
        return distinctValuesForColumn(doc, sheetId, view.range, filterDropdownCol)
    }, [doc, sheetId, view, filterDropdownCol])

    const existing =
        view != null && filterDropdownCol != null ? view.criteria[filterDropdownCol] : undefined
    const initialAllowed = useMemo(() => {
        if (existing?.type === 'values') return new Set(existing.allowedValues)
        return new Set(distinct)
    }, [existing, distinct])

    const [tab, setTab] = useState<Tab>(existing?.type === 'condition' ? 'condition' : 'values')
    const [allowed, setAllowed] = useState<Set<string>>(initialAllowed)
    const [op, setOp] = useState<FilterCondition['op']>(
        existing?.type === 'condition' ? existing.condition.op : 'contains'
    )
    const [conditionValue, setConditionValue] = useState<string>(
        existing?.type === 'condition' && 'value' in existing.condition ? existing.condition.value : ''
    )

    // Re-seed local state when the dropdown opens for a different
    // column. Without this, switching columns leaves stale checkboxes.
    useEffect(() => {
        if (filterDropdownCol == null) return
        setTab(existing?.type === 'condition' ? 'condition' : 'values')
        setAllowed(new Set(initialAllowed))
        if (existing?.type === 'condition') {
            setOp(existing.condition.op)
            setConditionValue('value' in existing.condition ? existing.condition.value : '')
        } else {
            setOp('contains')
            setConditionValue('')
        }
    }, [filterDropdownCol, existing, initialAllowed])

    // Web outside-click dismissal — same pattern as CellContextMenu.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (filterDropdownCol == null) return
        if (typeof document === 'undefined') return
        // Defer attach so the click that opened the dropdown doesn't
        // immediately close it.
        const t = setTimeout(() => {
            const handler = (event: MouseEvent) => {
                const targetNode = event.target as Node | null
                const node = panelRef.current as unknown as Node | null
                if (targetNode && node?.contains(targetNode)) return
                onClose()
            }
            document.addEventListener('pointerdown', handler, true)
            cleanupRef.current = () =>
                document.removeEventListener('pointerdown', handler, true)
        }, 0)
        return () => {
            clearTimeout(t)
            cleanupRef.current?.()
            cleanupRef.current = null
        }
    }, [filterDropdownCol, onClose])

    const onToggleValue = useCallback((value: string) => {
        setAllowed(prev => {
            const next = new Set(prev)
            if (next.has(value)) next.delete(value)
            else next.add(value)
            return next
        })
    }, [])

    const onSelectAll = useCallback(() => {
        setAllowed(new Set(distinct))
    }, [distinct])
    const onClearAll = useCallback(() => {
        setAllowed(new Set<string>())
    }, [])

    const onApply = useCallback(() => {
        if (doc == null || view == null || filterDropdownCol == null) {
            onClose()
            return
        }
        let criterion: FilterCriterion
        if (tab === 'values') {
            criterion = { type: 'values', allowedValues: [...allowed] }
        } else {
            const condition: FilterCondition =
                op === 'isEmpty' || op === 'isNotEmpty'
                    ? { op }
                    : { op, value: conditionValue }
            criterion = { type: 'condition', condition }
        }
        const nextCriteria = { ...view.criteria, [filterDropdownCol]: criterion }
        applyFilter(doc, sheetId, { range: view.range, criteria: nextCriteria })
        onClose()
    }, [doc, sheetId, view, filterDropdownCol, tab, allowed, op, conditionValue, onClose])

    const onClearColumn = useCallback(() => {
        if (doc == null || view == null || filterDropdownCol == null) {
            onClose()
            return
        }
        const next = { ...view.criteria }
        delete next[filterDropdownCol]
        if (Object.keys(next).length === 0) {
            clearFilter(doc, sheetId)
        } else {
            applyFilter(doc, sheetId, { range: view.range, criteria: next })
        }
        onClose()
    }, [doc, sheetId, view, filterDropdownCol, onClose])

    if (filterDropdownCol == null || anchorRect == null || view == null) return null

    const window = Dimensions.get('window')
    const PANEL_WIDTH = 280
    const left = Math.min(anchorRect.left, window.width - PANEL_WIDTH - 8)
    const top = anchorRect.top + anchorRect.height + 4

    return (
        <View
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                zIndex: 60,
            }}
            pointerEvents="box-none"
        >
            {Platform.OS !== 'web' && (
                <Pressable
                    onPress={onClose}
                    style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
                />
            )}
            <View
                ref={panelRef}
                accessibilityLabel={`Filter column ${columnLabel(filterDropdownCol)}`}
                className="bg-background border border-border rounded-lg"
                style={{
                    position: 'absolute',
                    left,
                    top,
                    width: PANEL_WIDTH,
                    padding: 8,
                    ...(Platform.OS === 'web'
                        ? ({ boxShadow: '0 4px 16px rgba(0,0,0,0.15)' } as object)
                        : {
                              elevation: 8,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 4 },
                              shadowOpacity: 0.15,
                              shadowRadius: 12,
                          }),
                }}
            >
                <View className="flex-row" style={{ gap: 4, marginBottom: 8 }}>
                    <TabButton label="Values" active={tab === 'values'} onPress={() => setTab('values')} />
                    <TabButton
                        label="Condition"
                        active={tab === 'condition'}
                        onPress={() => setTab('condition')}
                    />
                </View>
                {tab === 'values' ? (
                    <ValuesTab
                        distinct={distinct}
                        allowed={allowed}
                        onToggleValue={onToggleValue}
                        onSelectAll={onSelectAll}
                        onClearAll={onClearAll}
                    />
                ) : (
                    <ConditionTab
                        op={op}
                        value={conditionValue}
                        onChangeOp={setOp}
                        onChangeValue={setConditionValue}
                        fg={fg}
                    />
                )}
                <View
                    className="flex-row items-center justify-between"
                    style={{ marginTop: 8, gap: 8 }}
                >
                    <Pressable
                        onPress={onClearColumn}
                        accessibilityLabel="Clear filter"
                        className="px-3 py-2 rounded border border-border"
                    >
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            Clear
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={onApply}
                        accessibilityLabel="Apply filter"
                        className="px-3 py-2 rounded bg-accent"
                    >
                        <Text className="text-accent-foreground" style={{ fontSize: 13 }}>
                            Apply
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

interface TabButtonProps {
    label: string
    active: boolean
    onPress: () => void
}

function TabButton({ label, active, onPress }: TabButtonProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityLabel={`${label} tab`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className={`px-3 py-1 rounded ${active ? 'bg-accent' : ''}`}
        >
            <Text
                className={active ? 'text-accent-foreground' : 'text-foreground'}
                style={{ fontSize: 13 }}
            >
                {label}
            </Text>
        </Pressable>
    )
}

interface ValuesTabProps {
    distinct: string[]
    allowed: Set<string>
    onToggleValue: (value: string) => void
    onSelectAll: () => void
    onClearAll: () => void
}

function ValuesTab({ distinct, allowed, onToggleValue, onSelectAll, onClearAll }: ValuesTabProps) {
    return (
        <View>
            <View className="flex-row" style={{ gap: 8, marginBottom: 4 }}>
                <Pressable
                    onPress={onSelectAll}
                    accessibilityLabel="Select all"
                    className="px-2 py-1 rounded border border-border"
                >
                    <Text className="text-foreground" style={{ fontSize: 12 }}>
                        Select all
                    </Text>
                </Pressable>
                <Pressable
                    onPress={onClearAll}
                    accessibilityLabel="Clear values"
                    className="px-2 py-1 rounded border border-border"
                >
                    <Text className="text-foreground" style={{ fontSize: 12 }}>
                        Clear
                    </Text>
                </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 220 }} className="border-border rounded">
                {distinct.map(value => {
                    const checked = allowed.has(value)
                    const display = value === '' ? '(blanks)' : value
                    return (
                        <Pressable
                            key={value}
                            onPress={() => onToggleValue(value)}
                            accessibilityLabel={display}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked }}
                            className="flex-row items-center px-2 py-1"
                            style={{ gap: 8 }}
                        >
                            <View
                                className={`border ${checked ? 'bg-accent border-accent' : 'border-border'}`}
                                style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: 3,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                {checked ? (
                                    <Text style={{ fontSize: 10, color: 'white' }}>✓</Text>
                                ) : null}
                            </View>
                            <Text className="text-foreground" style={{ fontSize: 13 }}>
                                {display}
                            </Text>
                        </Pressable>
                    )
                })}
            </ScrollView>
        </View>
    )
}

interface ConditionTabProps {
    op: FilterCondition['op']
    value: string
    onChangeOp: (op: FilterCondition['op']) => void
    onChangeValue: (value: string) => void
    fg: string
}

function ConditionTab({ op, value, onChangeOp, onChangeValue, fg }: ConditionTabProps) {
    const requiresValue = op !== 'isEmpty' && op !== 'isNotEmpty'
    return (
        <View>
            <ScrollView style={{ maxHeight: 180 }} className="border-border rounded">
                {CONDITION_OPS.map(option => {
                    const active = option.op === op
                    return (
                        <Pressable
                            key={option.op}
                            onPress={() => onChangeOp(option.op)}
                            accessibilityLabel={option.label}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            className={`px-2 py-1 ${active ? 'bg-accent' : ''}`}
                        >
                            <Text
                                className={active ? 'text-accent-foreground' : 'text-foreground'}
                                style={{ fontSize: 13 }}
                            >
                                {option.label}
                            </Text>
                        </Pressable>
                    )
                })}
            </ScrollView>
            {requiresValue ? (
                <TextInput
                    value={value}
                    onChangeText={onChangeValue}
                    accessibilityLabel="Condition value"
                    placeholder="Value"
                    style={{
                        marginTop: 8,
                        borderWidth: 1,
                        borderRadius: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 6,
                        color: fg,
                    }}
                    className="border-border"
                />
            ) : null}
        </View>
    )
}

interface FilterDropdownAnchorProps {
    doc: Y.Doc | null
    sheetId: string
    colOffsets: Float64Array
    scrollX: number
}

// Measures the screen position of the column header that owns the
// open filter dropdown so the popover anchors to it. Subscribes to
// filterDropdownCol locally so the rest of Grid doesn't re-render on
// open/close. colOffsets / scrollX come from Grid because only Grid
// has them.
export function FilterDropdownAnchor({
    doc,
    sheetId,
    colOffsets,
    scrollX,
}: FilterDropdownAnchorProps) {
    const filterDropdownCol = useGridStore(s => s.filterDropdownCol)
    if (filterDropdownCol == null)
        return <FilterDropdown doc={doc} sheetId={sheetId} anchorRect={null} />
    const left = colOffsets[filterDropdownCol - 1] ?? 0
    const right = colOffsets[filterDropdownCol] ?? left
    const width = right - left
    // colOffsets is content-relative; subtract scrollX to land in the
    // viewport coordinate space the dropdown's `position: absolute`
    // expects. Header sits at top: TOOLBAR + FORMULA_BAR (~64px) — we
    // approximate with a fixed offset since the dropdown doesn't need
    // pixel-perfect anchoring (Body's grid flex layout pushes the
    // headers down). Worst case the dropdown sits a hair below the
    // visible header, which is the standard Sheets behaviour.
    const screenLeft = left - scrollX + 40
    const screenTop = 64
    return (
        <FilterDropdown
            doc={doc}
            sheetId={sheetId}
            anchorRect={{ left: screenLeft, top: screenTop, width, height: 0 }}
        />
    )
}
