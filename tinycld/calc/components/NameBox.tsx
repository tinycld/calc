import { useCallback, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import type * as Y from 'yjs'
import { useGridStore, useGridStoreApi } from '../hooks/use-grid-store'
import { useNamedRanges } from '../hooks/use-named-ranges'
import { useAllYSheets, useYSheets } from '../hooks/use-y-sheets'
import { encodeSheetName } from '../lib/named-ranges/sheet-prefix'
import { validateName } from '../lib/named-ranges/y-binding'
import { parseA1Range } from '../lib/pivot/range-parse'
import { primaryAnchor, type Selection } from '../lib/selection-range'
import { useNamedRangesDialogStore } from '../lib/stores/named-ranges-dialog-store'
import { columnLabel } from '../lib/workbook-types'

export interface NameBoxProps {
    doc: Y.Doc | null
    sheetId: string
}

// NameBox sits to the left of the formula bar (the small monospace
// chip that used to render `B7`). It now does triple duty:
//
//   1. Display: shows the current selection's address. A single cell
//      → `B7`. A range → `B7:D12`. If the current selection matches
//      a defined name exactly (case-insensitive expression compare),
//      shows the name instead of the address.
//   2. Dropdown: a chevron opens a menu listing defined names in
//      scope (global + this sheet). Clicking one jumps the selection
//      to its range.
//   3. Typing: focusing the input lets the user type either an A1
//      address (`B7:D12` or `Sheet2!A1:C10`) to jump selection, or
//      a new identifier to open the Name Manager pre-filled with the
//      current selection as the expression.
export function NameBox({ doc, sheetId }: NameBoxProps) {
    const store = useGridStoreApi()
    const selection = useGridStore(s => s.selection)
    const sheets = useAllYSheets(doc)
    const visibleSheets = useYSheets(doc)
    const ranges = useNamedRanges(doc)
    const openDialog = useNamedRangesDialogStore(s => s.openCreate)
    const openList = useNamedRangesDialogStore(s => s.openList)

    const [editing, setEditing] = useState<string | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)

    const activeSheetName = useMemo(
        () => sheets.find(s => s.id === sheetId)?.name ?? null,
        [sheets, sheetId]
    )

    const currentSelectionExpression = useMemo(() => {
        if (activeSheetName == null) return null
        return selectionToExpression(selection, activeSheetName)
    }, [selection, activeSheetName])

    // Display: name match (preferred) or address.
    const displayLabel = useMemo(() => {
        const addr = selectionAddressLabel(selection)
        if (currentSelectionExpression != null) {
            const match = ranges.find(
                r =>
                    (r.range.scope == null || r.range.scope === sheetId) &&
                    normalizeExpression(r.range.expression) ===
                        normalizeExpression(currentSelectionExpression)
            )
            if (match != null) return match.range.name
        }
        return addr
    }, [selection, currentSelectionExpression, ranges, sheetId])

    const onCommit = useCallback(() => {
        const raw = (editing ?? '').trim()
        setEditing(null)
        if (raw === '') return

        // 1. Try name match (case-insensitive). Names in scope are
        //    the workbook globals + this sheet's locals.
        const lowered = raw.toLowerCase()
        const matchedName = ranges.find(
            r => (r.range.scope == null || r.range.scope === sheetId) && r.key === lowered
        )
        if (matchedName != null) {
            jumpToExpression(
                store,
                visibleSheets,
                sheetId,
                matchedName.range.expression,
                activeSheetName
            )
            return
        }

        // 2. Try absolute A1 address (sheet-qualified or current sheet).
        const jumped = tryJumpToAddress(store, visibleSheets, sheetId, raw)
        if (jumped) return

        // 3. Treat as a new identifier: open the manager pre-filled
        //    with the current selection's absolute expression.
        const nameCheck = validateName(raw)
        if (!nameCheck.ok) return
        openDialog({
            name: raw,
            expression: currentSelectionExpression ?? undefined,
            scope: null,
        })
    }, [
        editing,
        ranges,
        store,
        visibleSheets,
        sheetId,
        activeSheetName,
        currentSelectionExpression,
        openDialog,
    ])

    const onPickName = useCallback(
        (expression: string) => {
            setMenuOpen(false)
            jumpToExpression(store, visibleSheets, sheetId, expression, activeSheetName)
        },
        [store, visibleSheets, sheetId, activeSheetName]
    )

    const inScope = useMemo(
        () => ranges.filter(r => r.range.scope == null || r.range.scope === sheetId),
        [ranges, sheetId]
    )

    return (
        <View
            className="bg-surface-secondary border border-border rounded flex-row items-center"
            style={{ width: 130, height: 22, marginRight: 6 }}
        >
            <TextInput
                value={editing ?? displayLabel}
                onFocus={() => setEditing(displayLabel)}
                onChangeText={setEditing}
                onSubmitEditing={onCommit}
                onBlur={onCommit}
                placeholder=""
                accessibilityLabel="Name box"
                style={{ flex: 1, height: 22, fontSize: 12, paddingHorizontal: 4 }}
                className="text-foreground"
            />
            <Pressable
                onPress={() => setMenuOpen(o => !o)}
                accessibilityRole="button"
                accessibilityLabel="Name box menu"
                className="px-1"
            >
                <Text className="text-xs text-muted-foreground">▾</Text>
            </Pressable>
            {menuOpen ? (
                <NameMenu
                    ranges={inScope}
                    activeSheetId={sheetId}
                    onPickName={onPickName}
                    onClose={() => setMenuOpen(false)}
                    onManage={() => {
                        setMenuOpen(false)
                        openList()
                    }}
                />
            ) : null}
        </View>
    )
}

interface NameMenuProps {
    ranges: ReturnType<typeof useNamedRanges>
    activeSheetId: string
    onPickName: (expression: string) => void
    onClose: () => void
    onManage: () => void
}

function NameMenu({ ranges, activeSheetId, onPickName, onClose, onManage }: NameMenuProps) {
    const globals = ranges.filter(r => r.range.scope == null)
    const locals = ranges.filter(r => r.range.scope === activeSheetId)
    return (
        <View
            className="absolute bg-background border border-border rounded shadow"
            style={{ top: 24, left: 0, minWidth: 200, paddingVertical: 4, zIndex: 1000 }}
        >
            {globals.length === 0 && locals.length === 0 ? (
                <View className="px-3 py-2">
                    <Text className="text-xs text-muted-foreground">No names yet</Text>
                </View>
            ) : null}
            {globals.length > 0 ? (
                <View>
                    <Text className="px-3 py-1 text-[10px] text-muted-foreground uppercase">
                        Workbook
                    </Text>
                    {globals.map(r => (
                        <Pressable
                            key={r.key}
                            onPress={() => onPickName(r.range.expression)}
                            className="px-3 py-1"
                            accessibilityLabel={`Go to ${r.range.name}`}
                        >
                            <Text className="text-xs text-foreground">{r.range.name}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {locals.length > 0 ? (
                <View>
                    <Text className="px-3 py-1 text-[10px] text-muted-foreground uppercase">
                        This sheet
                    </Text>
                    {locals.map(r => (
                        <Pressable
                            key={r.key}
                            onPress={() => onPickName(r.range.expression)}
                            className="px-3 py-1"
                            accessibilityLabel={`Go to ${r.range.name}`}
                        >
                            <Text className="text-xs text-foreground">{r.range.name}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            <View className="border-t border-border mt-1 pt-1">
                <Pressable onPress={onManage} className="px-3 py-1">
                    <Text className="text-xs text-foreground">Manage names…</Text>
                </Pressable>
                <Pressable onPress={onClose} className="px-3 py-1">
                    <Text className="text-xs text-muted-foreground">Close</Text>
                </Pressable>
            </View>
        </View>
    )
}

// selectionAddressLabel formats the current selection as A1 text for
// the display chip. Single cell → `B7`. Single rectangular range →
// `B7:D12`. Disjoint or empty selection collapses to the active anchor
// (the formula-bar chip already did the empty-case fallback before).
function selectionAddressLabel(selection: Selection): string {
    const anchor = primaryAnchor(selection)
    if (anchor == null) return ''
    const range = selection?.ranges[selection.ranges.length - 1]?.range
    if (range == null) return `${columnLabel(anchor.col)}${anchor.row}`
    if (range.startRow === range.endRow && range.startCol === range.endCol) {
        return `${columnLabel(range.startCol)}${range.startRow}`
    }
    return `${columnLabel(range.startCol)}${range.startRow}:${columnLabel(range.endCol)}${range.endRow}`
}

// selectionToExpression encodes the current selection as a sheet-
// qualified absolute A1 reference suitable for use as a named-range
// expression. Single cell → `=Sheet1!$B$7`, range → `=Sheet1!$B$7:$D$12`.
// Returns null when the selection has no anchor.
function selectionToExpression(selection: Selection, activeSheetName: string): string | null {
    const anchor = primaryAnchor(selection)
    if (anchor == null) return null
    const range = selection?.ranges[selection.ranges.length - 1]?.range
    const sheet = encodeSheetName(activeSheetName)
    if (range == null) {
        return `=${sheet}!$${columnLabel(anchor.col)}$${anchor.row}`
    }
    if (range.startRow === range.endRow && range.startCol === range.endCol) {
        return `=${sheet}!$${columnLabel(range.startCol)}$${range.startRow}`
    }
    return `=${sheet}!$${columnLabel(range.startCol)}$${range.startRow}:$${columnLabel(
        range.endCol
    )}$${range.endRow}`
}

// normalizeExpression compares two A1 reference strings up to absolute
// vs relative markers and trailing equals. Lets the display logic
// detect that the current selection matches a defined name even when
// the name was stored as `=Sheet1!$A$1:$A$10` and the selection
// formats as `=Sheet1!$A$1:$A$10` too — same string after trim.
function normalizeExpression(expr: string): string {
    return expr.replace(/^=/, '').toUpperCase().trim()
}

// tryJumpToAddress accepts user-typed A1 text and, when it parses as a
// valid cell or range (optionally sheet-qualified), updates the
// selection. Returns true on success, false when the input wasn't an
// address (so the caller can fall through to the "open Name Manager"
// path).
function tryJumpToAddress(
    store: ReturnType<typeof useGridStoreApi>,
    sheets: ReturnType<typeof useYSheets>,
    currentSheetId: string,
    raw: string
): boolean {
    // Sheet-qualified range like `Sheet2!A1:C10`.
    if (raw.includes('!')) {
        const result = parseA1Range(raw)
        if (!result.ok) return false
        const target = sheets.find(s => s.name === result.sheetName)
        if (target == null) return false
        // NameBox doesn't switch sheets; jump only when the prefix
        // matches the active sheet. (Cross-sheet navigation would need
        // to call back into the URL-as-truth path.)
        if (target.id !== currentSheetId) return false
        store.getState().selectCell({ row: result.startRow, col: result.startCol })
        if (result.startRow !== result.endRow || result.startCol !== result.endCol) {
            store.getState().extendActiveRangeTo({ row: result.endRow, col: result.endCol })
        }
        return true
    }
    // Unqualified `B7` or `B7:D12` — current sheet.
    const colon = raw.indexOf(':')
    if (colon < 0) {
        const cell = parseCellLabel(raw)
        if (cell == null) return false
        store.getState().selectCell(cell)
        return true
    }
    const startCell = parseCellLabel(raw.slice(0, colon))
    const endCell = parseCellLabel(raw.slice(colon + 1))
    if (startCell == null || endCell == null) return false
    store.getState().selectCell(startCell)
    store.getState().extendActiveRangeTo(endCell)
    return true
}

const CELL_RE = /^\$?([A-Z]+)\$?(\d+)$/i

function parseCellLabel(s: string): { row: number; col: number } | null {
    const m = CELL_RE.exec(s.trim())
    if (m == null) return null
    let col = 0
    const letters = m[1].toUpperCase()
    for (let i = 0; i < letters.length; i++) {
        col = col * 26 + (letters.charCodeAt(i) - 64)
    }
    const row = Number(m[2])
    if (!Number.isFinite(row) || row < 1 || col < 1) return null
    return { row, col }
}

// jumpToExpression evaluates a named-range expression and (when it
// resolves to a cell or range on the current sheet) updates the
// selection. Constants / cross-sheet refs / non-range expressions
// silently no-op — the name box can't navigate to those.
function jumpToExpression(
    store: ReturnType<typeof useGridStoreApi>,
    sheets: ReturnType<typeof useYSheets>,
    currentSheetId: string,
    expression: string,
    activeSheetName: string | null
): void {
    const trimmed = expression.replace(/^=/, '').trim()
    if (trimmed === '') return
    // Try the sheet-qualified parser first.
    if (trimmed.includes('!')) {
        const result = parseA1Range(trimmed.includes(':') ? trimmed : `${trimmed}:${trimmed}`)
        if (result.ok) {
            const target = sheets.find(s => s.name === result.sheetName)
            if (target == null || target.id !== currentSheetId) return
            store.getState().selectCell({ row: result.startRow, col: result.startCol })
            if (result.startRow !== result.endRow || result.startCol !== result.endCol) {
                store.getState().extendActiveRangeTo({ row: result.endRow, col: result.endCol })
            }
            return
        }
    }
    // Bare A1 — assume current sheet.
    const noSheet = activeSheetName == null ? trimmed : trimmed
    const colon = noSheet.indexOf(':')
    if (colon < 0) {
        const cell = parseCellLabel(noSheet)
        if (cell == null) return
        store.getState().selectCell(cell)
        return
    }
    const start = parseCellLabel(noSheet.slice(0, colon))
    const end = parseCellLabel(noSheet.slice(colon + 1))
    if (start == null || end == null) return
    store.getState().selectCell(start)
    store.getState().extendActiveRangeTo(end)
}
