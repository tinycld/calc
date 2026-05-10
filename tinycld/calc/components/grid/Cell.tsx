import { memo, useCallback } from 'react'
import {
    type GestureResponderEvent,
    type NativeSyntheticEvent,
    PanResponder,
    Platform,
    Pressable,
    Text,
    TextInput,
    type TextInputSelectionChangeEventData,
} from 'react-native'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import type { RemotePresence } from '../../hooks/use-presence'
import { useWorkbook } from '../../hooks/use-workbook-context'
import { useYCell } from '../../hooks/use-y-cell'
import { cellStyleToRenderProps } from '../../lib/cell-style-render'
import { columnLabel, formatCell } from '../../lib/workbook-types'
import type { FormulaSpecialKey } from '../FormulaBar'
import { locateCellAtGridCoord } from './style-helpers'

interface CellProps {
    sheetId: string
    row: number
    col: number
    // Pre-computed by the parent so a width/height change in column N
    // or row M doesn't invalidate every memoized cell — only that
    // column's or row's cells get new left/top/width/height props.
    left: number
    top: number
    width: number
    height: number
    readOnly: boolean
    cellEditorInputRef: React.RefObject<TextInput | null>
    remoteEditor: RemotePresence | null
    colOffsets: Float64Array
    rowOffsets: Float64Array
    onSpecialKey: (key: FormulaSpecialKey) => boolean
}

export const Cell = memo(function Cell({
    sheetId,
    row,
    col,
    left,
    top,
    width,
    height,
    readOnly,
    cellEditorInputRef,
    remoteEditor,
    colOffsets,
    rowOffsets,
    onSpecialKey,
}: CellProps) {
    const { doc } = useWorkbook()
    const store = useGridStoreApi()
    const cellValue = useYCell(doc, sheetId, row, col)

    // Primitive selectors — non-editing/non-selected cells get back
    // false on every store update and short-circuit reference-equality
    // checks, so they don't re-render. This is the keystroke-perf
    // contract: 1 cell renders per keystroke, not N visible cells.
    const isSelected = useGridStore(s => s.selected?.row === row && s.selected?.col === col)
    const isEditing = useGridStore(s => s.editSession?.row === row && s.editSession?.col === col)
    const isAnyEditing = useGridStore(s => s.editSession != null)

    // formatCell is the single source of truth for the visible string;
    // `display` on disk is still maintained as a cache for old peers
    // and the server-side serializer, but the live render computes from
    // (kind, raw) so future formatting (Phase 3 numFmt) lights up here
    // automatically.
    const display =
        cellValue == null
            ? ''
            : formatCell(cellValue.kind, cellValue.raw, cellValue.formula, cellValue.style?.numFmt)
    // Editing a formula cell should preload the formula expression
    // (e.g. "=SUM(A1:A2)"), not its computed result. This matches how
    // the formula bar surfaces formula text and lets users round-trip
    // a formula edit without losing the expression.
    const editDraft =
        cellValue?.kind === 'formula' && cellValue.formula ? cellValue.formula : display

    const remoteDraft = remoteEditor?.editing?.draft

    if (isEditing) {
        return (
            <CellEditor
                inputRef={cellEditorInputRef}
                left={left}
                top={top}
                width={width}
                height={height}
                row={row}
                col={col}
                onSpecialKey={onSpecialKey}
            />
        )
    }

    // When the user is editing a formula and taps this cell, intercept
    // the press to insert a ref instead of selecting/editing the cell.
    // cellRefTap returns false (no-op) when the cursor isn't in a
    // ref-acceptable position, falling through to the normal select/
    // edit gesture.
    const onPress = () => {
        const state = store.getState()
        if (state.cellRefTap(row, col)) return
        if (isSelected) {
            state.editCell({ row, col }, editDraft)
        } else {
            state.selectCell({ row, col })
        }
    }

    // Pan handlers for drag-range insertion. The threshold lets simple
    // taps fall through to onPress (which routes to ref insertion or
    // select/edit). cellRefDragStart returns false when the cursor
    // isn't in a ref-acceptable position; we still claim the gesture
    // here, which is fine — the drag is a no-op without a session.
    const panHandlers = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: () => {
            store.getState().cellRefDragStart(row, col)
        },
        onPanResponderMove: e => {
            const { locationX, locationY } = e.nativeEvent
            const gridX = left + locationX
            const gridY = top + locationY
            const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
            if (target != null) store.getState().cellRefDragMove(target.row, target.col)
        },
        onPanResponderRelease: () => store.getState().cellRefDragEnd(),
        onPanResponderTerminate: () => store.getState().cellRefDragEnd(),
    }).panHandlers

    // Native long-press fires before any subsequent onPress is dispatched,
    // so wiring the context menu here doesn't conflict with the
    // select-then-edit gesture above. Web uses onContextMenu (right-click)
    // via a DOM prop the RN-Web Pressable forwards but doesn't type.
    const onLongPress = readOnly
        ? undefined
        : (e: GestureResponderEvent) => {
              const { pageX, pageY } = e.nativeEvent
              store.getState().openCellContextMenu(row, col, pageX, pageY)
          }

    const webContextMenuProp =
        Platform.OS === 'web' && !readOnly
            ? {
                  onContextMenu: (e: {
                      preventDefault: () => void
                      clientX: number
                      clientY: number
                  }) => {
                      e.preventDefault()
                      store.getState().openCellContextMenu(row, col, e.clientX, e.clientY)
                  },
              }
            : null

    // While a formula edit is in progress, swallow the mousedown so
    // the focused TextInput doesn't blur — blur would commit the
    // half-typed formula (e.g. "=LEFT(") as a #ERROR! cell before
    // onPress runs and our ref-tap handler can insert the address.
    // Only applied on web; native taps don't blur the keyboard the
    // same way and our Pressable/PanResponder handle the gesture
    // before the input's onBlur fires.
    const webMouseDownProp =
        Platform.OS === 'web' && isAnyEditing
            ? {
                  onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
              }
            : null

    // Delete / Backspace on a focused (selected, not-editing) cell
    // clears its contents — same effect as the "Clear contents" item in
    // the cell context menu. Only fires when the cell isn't currently
    // editing, so a Backspace inside CellEditor still erases characters.
    const onCellKeyDown = (e: { key?: string; preventDefault?: () => void }) => {
        if (readOnly) return
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        e.preventDefault?.()
        store.getState().clearCellAt(row, col)
    }

    const showRemoteDraft = remoteDraft != null
    const renderStyle = cellStyleToRenderProps(cellValue?.style)
    // Remote-draft display layers a peer's color + italic on top of
    // the cell's own style. Spread the style-derived textStyle first
    // so the remote-draft color and italic override (matching the
    // pre-format behavior).
    const textStyle = showRemoteDraft
        ? {
              ...renderStyle.textStyle,
              color: remoteEditor?.user.color,
              fontStyle: 'italic' as const,
          }
        : renderStyle.textStyle

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            onKeyDown={onCellKeyDown}
            accessibilityLabel={`Cell ${columnLabel(col)}${row}`}
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                ...renderStyle.viewStyle,
            }}
            className="border-r border-b border-border bg-background justify-center px-1"
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...((webContextMenuProp ?? {}) as any)}
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...((webMouseDownProp ?? {}) as any)}
            {...panHandlers}
        >
            <Text className="text-xs" numberOfLines={renderStyle.numberOfLines} style={textStyle}>
                {showRemoteDraft ? remoteDraft : display}
            </Text>
        </Pressable>
    )
})

interface CellEditorProps {
    inputRef: React.RefObject<TextInput | null>
    left: number
    top: number
    width: number
    height: number
    row: number
    col: number
    onSpecialKey: (key: FormulaSpecialKey) => boolean
}

function CellEditor({
    inputRef,
    left,
    top,
    width,
    height,
    row,
    col,
    onSpecialKey,
}: CellEditorProps) {
    const store = useGridStoreApi()
    const draft = useGridStore(s => s.editSession?.draft ?? '')
    const selection = useGridStore(s => s.pendingSelection ?? undefined)
    const autoFocus = useGridStore(s => s.activeSurface === 'cell')

    const onChangeText = useCallback(
        (next: string) => store.getState().setEditDraft(row, col, next),
        [store, row, col]
    )
    const onSelectionChange = useCallback(
        (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
            const sel = e.nativeEvent.selection
            store.getState().setEditSelection(row, col, sel.start, sel.end)
        },
        [store, row, col]
    )
    const onSubmit = useCallback(() => {
        // Read the latest draft from the store at fire time — using
        // the closure-captured value would commit a stale string when
        // the user presses Enter immediately after typing (RN onBlur
        // and onSubmitEditing can fire with the live keystroke not yet
        // flushed through the closure).
        const session = store.getState().editSession
        if (session == null) return
        store.getState().commitEdit(row, col, session.draft)
    }, [store, row, col])
    const onFocus = useCallback(() => store.getState().setActiveSurface('cell'), [store])
    const onKeyPress = useCallback(
        (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
            const key = e.nativeEvent.key
            if (key === 'Escape') {
                if (onSpecialKey('Escape')) {
                    e.preventDefault?.()
                    return
                }
                store.getState().cancelEdit()
                return
            }
            if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Tab' || key === 'Enter') {
                if (onSpecialKey(key)) {
                    e.preventDefault?.()
                }
            }
        },
        [store, onSpecialKey]
    )

    return (
        <TextInput
            ref={inputRef}
            autoFocus={autoFocus}
            value={draft}
            selection={selection}
            onChangeText={onChangeText}
            onSelectionChange={onSelectionChange}
            onSubmitEditing={onSubmit}
            onBlur={onSubmit}
            onFocus={onFocus}
            onKeyPress={onKeyPress}
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                paddingHorizontal: 4,
                fontSize: 12,
                borderWidth: 2,
                borderColor: '#22a06b',
            }}
            className="bg-background text-foreground"
        />
    )
}
