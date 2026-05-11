import { memo, useCallback, useRef } from 'react'
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
import { type CellKeyEvent, classifyCellKey } from '../../lib/cell-key-action'
import { cellStyleToRenderProps } from '../../lib/cell-style-render'
import { findMergeContaining } from '../../lib/merge'
import {
    computeShiftArrowTarget,
    containsAny,
    primaryAnchor,
} from '../../lib/selection-range'
import { columnLabel, formatCell } from '../../lib/workbook-types'
import type { FormulaSpecialKey } from '../FormulaBar'
import { CommentIndicator } from './CommentIndicator'
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
    // Merge handling is delegated here so Body's loop stays a simple
    // (row, col) walk: covered cells return null, anchor cells extend
    // their rendered footprint over the merge's span.
    const merge = doc != null ? findMergeContaining(doc, sheetId, row, col) : null
    const isMergedCovered =
        merge != null && (merge.anchorRow !== row || merge.anchorCol !== col)
    let renderWidth = width
    let renderHeight = height
    if (merge != null && !isMergedCovered) {
        const lastCol = merge.anchorCol + merge.colSpan - 1
        const lastRow = merge.anchorRow + merge.rowSpan - 1
        if (lastCol < colOffsets.length) {
            renderWidth = colOffsets[lastCol] - left
        }
        if (lastRow < rowOffsets.length) {
            renderHeight = rowOffsets[lastRow] - top
        }
    }

    // Primitive selectors — non-editing/non-selected cells get back
    // false on every store update and short-circuit reference-equality
    // checks, so they don't re-render. This is the keystroke-perf
    // contract: 1 cell renders per keystroke, not N visible cells.
    //
    // isSelected reads the PRIMARY anchor (last sub-range). On a
    // single-rectangle selection this is the only anchor; on a
    // disjoint selection it's the most-recently-Ctrl-clicked cell.
    const isSelected = useGridStore(s => {
        const a = primaryAnchor(s.selection)
        return a?.row === row && a?.col === col
    })
    // True when this cell sits inside ANY sub-range of the selection
    // (single or disjoint). Returns a boolean primitive so cells
    // outside the selection short-circuit on equality.
    const isInRange = useGridStore(s => containsAny(s.selection, row, col))
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

    // useRef + useCallback must come before the early return for
    // the editing CellEditor branch — hooks rules require
    // unconditional ordering.
    const webDragRef = useRef<{
        startX: number
        startY: number
        startRect: { left: number; top: number }
        dragging: boolean
    } | null>(null)
    // Set in onMouseDown when we already handled the gesture
    // (shift-extend, drag-extend); consumed by onPress to skip the
    // single-cell selectCell that would otherwise collapse the
    // range. preventDefault on mousedown does NOT suppress the
    // browser's subsequent click event, so this gate is required.
    const skipNextPressRef = useRef(false)

    // Web drag-select via document-level pointer listeners.
    // Defined inline as a useCallback closure so it captures the
    // current cell's (row, col, left, top) and the live offset
    // arrays. See the longer comment near the JSX for the rationale
    // (Pressable + Pointer events don't compose cleanly on RN-Web).
    const webDragStart = useCallback(
        (clientX: number, clientY: number, rect: { left: number; top: number }) => {
            if (Platform.OS !== 'web' || readOnly) return
            if (typeof document === 'undefined') return
            if (isAnyEditing) return
            webDragRef.current = {
                startX: clientX,
                startY: clientY,
                startRect: rect,
                dragging: false,
            }
            const onMove = (ev: PointerEvent) => {
                const drag = webDragRef.current
                if (drag == null) return
                const dx = ev.clientX - drag.startX
                const dy = ev.clientY - drag.startY
                if (!drag.dragging) {
                    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
                    drag.dragging = true
                    // The synthetic click that fires after mouseup
                    // would otherwise hit Pressable's onPress and
                    // re-select the start cell, collapsing the range
                    // we're about to build. Suppress that click.
                    skipNextPressRef.current = true
                    store.getState().selectCell({ row, col })
                }
                // Use absolute grid offsets here, not the quadrant-
                // local `left`/`top` props — the cell's prop values
                // are relative to its containing quadrant's origin
                // (subtracting the frozen extent), while colOffsets/
                // rowOffsets — and therefore locateCellAtGridCoord —
                // are absolute prefix-sums. Mixing the two shifts the
                // mapped target by exactly the frozen extent on each
                // axis. See webDragStartCtrl below for the same fix.
                const absLeft = colOffsets[col - 1] ?? 0
                const absTop = rowOffsets[row - 1] ?? 0
                const gridX = absLeft + (ev.clientX - drag.startRect.left)
                const gridY = absTop + (ev.clientY - drag.startRect.top)
                const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
                if (target == null) return
                store.getState().extendActiveRangeTo(target)
            }
            const cleanup = () => {
                document.removeEventListener('pointermove', onMove)
                document.removeEventListener('pointerup', cleanup)
                document.removeEventListener('pointercancel', cleanup)
                webDragRef.current = null
            }
            document.addEventListener('pointermove', onMove)
            document.addEventListener('pointerup', cleanup)
            document.addEventListener('pointercancel', cleanup)
        },
        [store, row, col, left, top, colOffsets, rowOffsets, readOnly, isAnyEditing]
    )

    // Ctrl-drag variant of webDragStart. The mousedown handler has
    // already called addSubRange to append a new sub-range; this
    // function only handles subsequent pointermove → extend the
    // active (just-added) sub-range from ITS anchor. No selectCell
    // bootstrap.
    const webDragStartCtrl = useCallback(
        (clientX: number, clientY: number, rect: { left: number; top: number }) => {
            if (Platform.OS !== 'web' || readOnly) return
            if (typeof document === 'undefined') return
            if (isAnyEditing) return
            webDragRef.current = {
                startX: clientX,
                startY: clientY,
                startRect: rect,
                dragging: false,
            }
            const onMove = (ev: PointerEvent) => {
                const drag = webDragRef.current
                if (drag == null) return
                const dx = ev.clientX - drag.startX
                const dy = ev.clientY - drag.startY
                if (!drag.dragging) {
                    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
                    drag.dragging = true
                    // The new sub-range was already added on
                    // mousedown — no selectCell to call here.
                }
                const absLeft = colOffsets[col - 1] ?? 0
                const absTop = rowOffsets[row - 1] ?? 0
                const gridX = absLeft + (ev.clientX - drag.startRect.left)
                const gridY = absTop + (ev.clientY - drag.startRect.top)
                const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
                if (target == null) return
                store.getState().extendActiveRangeTo(target)
            }
            const cleanup = () => {
                document.removeEventListener('pointermove', onMove)
                document.removeEventListener('pointerup', cleanup)
                document.removeEventListener('pointercancel', cleanup)
                webDragRef.current = null
            }
            document.addEventListener('pointermove', onMove)
            document.addEventListener('pointerup', cleanup)
            document.addEventListener('pointercancel', cleanup)
        },
        [store, row, col, colOffsets, rowOffsets, readOnly, isAnyEditing]
    )

    if (isMergedCovered) return null

    if (isEditing) {
        return (
            <CellEditor
                inputRef={cellEditorInputRef}
                left={left}
                top={top}
                width={renderWidth}
                height={renderHeight}
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
        // mousedown already handled the gesture (shift-extend or
        // drag-extend) — don't double-act here and collapse the
        // range. The flag is consumed exactly once per click.
        if (skipNextPressRef.current) {
            skipNextPressRef.current = false
            return
        }
        const state = store.getState()
        if (state.cellRefTap(row, col)) return
        if (isSelected) {
            state.editCell({ row, col }, editDraft)
        } else {
            state.selectCell({ row, col })
        }
    }

    // Touch/native drag: PanResponder branches on whether an edit
    // session is in flight at gesture-start time:
    //
    //   - During a formula edit → ref-drag: cellRefDragStart claims
    //     the gesture (or returns false if the cursor isn't in a
    //     ref-acceptable spot). Subsequent moves stretch the inserted
    //     range; release re-focuses the input.
    //   - Otherwise → selection-drag: anchor on the start cell, then
    //     extend the selection rectangle to whichever cell the pointer
    //     is over. The 3px move threshold still lets simple taps fall
    //     through to onPress.
    //
    // Web uses native PointerEvents instead (see webPointerProps
    // below) — RN-Web's PanResponder is unreliable for mouse-only
    // gestures, mirroring the same dual-mode pattern used by
    // useColumnResize.
    let activeDragMode: 'ref' | 'select' | null = null
    const panHandlers = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: () => {
            const state = store.getState()
            if (state.editSession != null) {
                activeDragMode = 'ref'
                state.cellRefDragStart(row, col)
            } else {
                activeDragMode = 'select'
                state.selectCell({ row, col })
            }
        },
        onPanResponderMove: e => {
            const { locationX, locationY } = e.nativeEvent
            // Mirror the web fix: use absolute grid offsets, not the
            // quadrant-local `left`/`top` props.
            const absLeft = colOffsets[col - 1] ?? 0
            const absTop = rowOffsets[row - 1] ?? 0
            const gridX = absLeft + locationX
            const gridY = absTop + locationY
            const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
            if (target == null) return
            if (activeDragMode === 'ref') {
                store.getState().cellRefDragMove(target.row, target.col)
            } else if (activeDragMode === 'select') {
                store.getState().extendActiveRangeTo(target)
            }
        },
        onPanResponderRelease: () => {
            if (activeDragMode === 'ref') store.getState().cellRefDragEnd()
            activeDragMode = null
        },
        onPanResponderTerminate: () => {
            if (activeDragMode === 'ref') store.getState().cellRefDragEnd()
            activeDragMode = null
        },
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

    // Web onMouseDown serves three purposes:
    //
    //   1. While a formula edit is in progress, swallow the mousedown
    //      so the focused TextInput doesn't blur — blur would commit
    //      the half-typed formula (e.g. "=LEFT(") as a #ERROR! cell
    //      before onPress runs and our ref-tap handler can insert the
    //      address.
    //   2. Shift+click extends the current selection to this cell.
    //      RN's GestureResponderEvent doesn't expose modifier keys, so
    //      we have to peek at the underlying DOM event before the
    //      Pressable's onPress fires (which would call selectCell and
    //      collapse the range).
    //   3. Bootstrap the document-level pointer-drag listeners that
    //      power click-and-drag selection. mousedown fires before any
    //      potential focus shift or onPress, so installing listeners
    //      here means we catch the very first pointermove. Routing
    //      through onPressIn (Pressable's RN-Web equivalent) instead
    //      breaks the click-away-commits-edit flow, so we wire here.
    //
    // Native taps don't blur the keyboard the same way, and physical
    // shift on mobile is rare — both paths are web-only.
    const webMouseDownProp =
        Platform.OS === 'web'
            ? {
                  onMouseDown: (e: {
                      preventDefault: () => void
                      shiftKey?: boolean
                      ctrlKey?: boolean
                      metaKey?: boolean
                      button?: number
                      clientX?: number
                      clientY?: number
                      currentTarget?: {
                          getBoundingClientRect?: () => { left: number; top: number }
                      }
                  }) => {
                      // Right-click is handled by onContextMenu; don't
                      // intercept here.
                      if (e.button != null && e.button !== 0) return
                      const isCtrl = e.ctrlKey || e.metaKey
                      // Ctrl/Cmd-click (with or without Shift) appends
                      // a new sub-range and bootstraps a drag from it
                      // — Sheets parity. Ctrl+Shift falls through to
                      // the Ctrl branch (most-recent additive
                      // gesture wins, plan §5).
                      if (isCtrl && !isAnyEditing && !readOnly) {
                          e.preventDefault()
                          skipNextPressRef.current = true
                          store.getState().addSubRange({ row, col })
                          // After addSubRange the just-added sub-
                          // range is active; if the user starts
                          // dragging, extendActiveRangeTo will grow
                          // THAT sub-range from its anchor.
                          const clientX = typeof e.clientX === 'number' ? e.clientX : 0
                          const clientY = typeof e.clientY === 'number' ? e.clientY : 0
                          const rect = e.currentTarget?.getBoundingClientRect?.() ?? {
                              left: 0,
                              top: 0,
                          }
                          webDragStartCtrl(clientX, clientY, {
                              left: rect.left,
                              top: rect.top,
                          })
                          return
                      }
                      if (e.shiftKey && !isAnyEditing && !readOnly) {
                          // Shift-extend: stretch the active (last)
                          // sub-range from its anchor to this cell.
                          // preventDefault on mousedown blocks the
                          // focus shift but NOT the synthetic click
                          // that fires after mouseup, so we also
                          // flag skipNextPressRef so onPress doesn't
                          // run selectCell and collapse the range we
                          // just built.
                          e.preventDefault()
                          skipNextPressRef.current = true
                          store.getState().extendActiveRangeTo({ row, col })
                          return
                      }
                      if (isAnyEditing) {
                          e.preventDefault()
                          return
                      }
                      // Plain drag-select. The first pointermove past
                      // the threshold turns this into an actual range-
                      // extend; pure clicks fall through to onPress
                      // (single-cell select).
                      const clientX = typeof e.clientX === 'number' ? e.clientX : 0
                      const clientY = typeof e.clientY === 'number' ? e.clientY : 0
                      const rect = e.currentTarget?.getBoundingClientRect?.() ?? {
                          left: 0,
                          top: 0,
                      }
                      webDragStart(clientX, clientY, { left: rect.left, top: rect.top })
                  },
              }
            : null

    // Keyboard handling on a focused (selected, not-editing) cell.
    // Delete / Backspace clear the active selection (whole range, not
    // just the anchor); a printable single-character key opens the
    // editor with that character as the seed (Sheets / Excel
    // typing-to-replace). Modifier combos belong to the global
    // shortcut registry, not here. See classifyCellKey for the rules.
    const onCellKeyDown = (e: CellKeyEvent & { preventDefault?: () => void }) => {
        if (readOnly) return
        const action = classifyCellKey(e)
        if (action.kind === 'ignore') return
        if (action.kind === 'arrow') {
            // Plan §6.c: arrow on a disjoint selection collapses to a
            // single cell at the primary anchor. The focus traversal
            // then continues normally so the neighbor cell takes
            // focus. On a single-rectangle selection collapseToPrimary
            // is a no-op when already single-cell; on a multi-cell
            // rectangle it shrinks to the anchor — matches Sheets.
            store.getState().collapseToPrimary()
            // Don't preventDefault — the browser still needs to move
            // focus to the neighbor cell.
            return
        }
        if (action.kind === 'extend') {
            // Sheets/Excel parity: Shift+arrow grows or shrinks the
            // active sub-range by one cell along the chosen axis. The
            // anchor stays put; the corner opposite the anchor moves.
            // preventDefault so the browser doesn't also walk focus
            // off the anchor cell.
            e.preventDefault?.()
            const state = store.getState()
            const next = computeShiftArrowTarget(
                state.selection,
                action.direction,
                row,
                col,
                rowOffsets.length - 1,
                colOffsets.length - 1
            )
            store.getState().extendActiveRangeTo(next)
            return
        }
        e.preventDefault?.()
        if (action.kind === 'clear') {
            store.getState().clearSelection()
            return
        }
        store.getState().editCell({ row, col }, action.seed)
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

    // Cells inside a multi-cell range get a translucent tint so the
    // user can see the full extent of the selection. The anchor cell
    // is excluded — its outlined border (drawn by LocalSelectionOverlay
    // and the PrimaryAnchorOverlay) is the visual cue for "this is
    // where typing/formula bar is rooted". Drawn before the cell's own
    // viewStyle so any user-set fill paints over the tint.
    const rangeTintStyle =
        isInRange && !isSelected ? { backgroundColor: 'rgba(34, 160, 107, 0.10)' } : null

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
                width: renderWidth,
                height: renderHeight,
                ...rangeTintStyle,
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
            <CommentIndicator sheetId={sheetId} row={row} col={col} />
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
