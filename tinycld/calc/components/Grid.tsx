import { Menu, Separator } from '@tinycld/core/ui/menu'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
    type GestureResponderEvent,
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    type TextInputSelectionChangeEventData,
    View,
} from 'react-native'
import type * as Y from 'yjs'
import {
    type DragState,
    HANDLE_VISUAL_WIDTH,
    NATIVE_HANDLE_HIT_SLOP,
    runAutosize,
    useColumnResize,
} from '../hooks/use-column-resize'
import { useFormulaFunctionNames } from '../hooks/use-formula-function-names'
import { type RemotePresence, usePresence } from '../hooks/use-presence'
import type { UndoManagerState } from '../hooks/use-undo-manager'
import { useWorkbook } from '../hooks/use-workbook-context'
import { setYCell, setYCellStyle, useYCell } from '../hooks/use-y-cell'
import { type SheetWithId, useYSheets } from '../hooks/use-y-sheets'
import { buildColOffsets, DEFAULT_COL_WIDTH, firstColAtOffset, lastColAtOffset, setYColWidth } from '../lib/dimensions'
import {
    applyFunctionInsertion,
    type DraftSelection,
    filterFunctions,
    parseFunctionToken,
} from '../lib/formula/autocomplete'
import {
    applyCellRefInsertion,
    extendCellRefInsertion,
    formatRange,
    formatRef,
    isRefAcceptable,
} from '../lib/formula/cell-ref-insertion'
import { columnLabel, formatCell } from '../lib/workbook-types'
import { yCellKey } from '../lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../lib/y-doc-bootstrap'
import { FormulaBar, type FormulaSpecialKey } from './FormulaBar'
import { FormulaSuggestionList } from './FormulaSuggestionList'
import { Toolbar } from './Toolbar'

const CELL_HEIGHT = 28
const ROW_HEADER_WIDTH = 48
const HEADER_HEIGHT = CELL_HEIGHT
const TOOLBAR_HEIGHT = 28
const FORMULA_BAR_HEIGHT = 28
const OVERSCAN = 4
const MIN_ROWS = 50
const MIN_COLS = 26

// Inset shadow applied to the active row/column header cell on top of
// the bg-accent fill. Two paired insets produce a "pressed" look — a
// dim top-left edge plus a slightly brighter bottom-right edge, like
// the cell is sunken into the toolbar. RN-Web compiles boxShadow to
// CSS; on native, `style.boxShadow` is ignored gracefully (the bg +
// bold text already convey the active state without it).
const ACTIVE_HEADER_INSET_STYLE = {
    boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.18), inset -1px -1px 0 rgba(255,255,255,0.18)',
} as const

export interface GridHandle {
    scrollToCell: (row: number, col: number) => void
}

interface GridProps {
    sheetId: string
    minRows?: number
    minCols?: number
    readOnly?: boolean
    // Comes from useUndoManager(doc) at the screen level so the
    // toolbar buttons and the Cmd-Z keyboard shortcuts share one
    // Y.UndoManager instance.
    undoState: UndoManagerState
}

interface SelectedCell {
    row: number
    col: number
}

interface EditSession {
    row: number
    col: number
    draft: string
}

// Which input surface most recently held focus. The suggestion popover
// anchors below the formula bar OR below the editing cell depending on
// this — neither input has knowledge of the other's geometry.
type ActiveSurface = 'bar' | 'cell'

// A ref drag in progress while a formula is being edited. anchor is
// the first cell pressed; end tracks the cell currently under the
// pointer/finger. lastSlice is the substring index range of the most
// recent insertion in the draft, so the next pointer-move replaces it
// instead of appending another address.
interface RefDrag {
    anchor: { row: number; col: number }
    end: { row: number; col: number }
    lastSlice: { start: number; end: number }
}

interface Viewport {
    scrollX: number
    scrollY: number
    width: number
    height: number
}

export const Grid = forwardRef<GridHandle, GridProps>(function Grid(
    { sheetId, minRows = MIN_ROWS, minCols = MIN_COLS, readOnly = false, undoState },
    ref
) {
    const { doc, awareness } = useWorkbook()
    const sheets = useYSheets(doc)
    const sheet = sheets.find((s) => s.id === sheetId) ?? null

    const rows = Math.max(sheet?.rowCount ?? 0, minRows)
    const cols = Math.max(sheet?.colCount ?? 0, minCols)

    // Prefix-sum of column widths. colOffsets[c] is the LEFT edge of
    // column c+1 (so colOffsets[0]=0, colOffsets[cols]=contentWidth).
    // Reused by every position lookup in render. Recomputed only when
    // the sheet's colWidths object identity changes (which happens
    // exactly when a peer or the local user resizes a column — see
    // useYSheets snapshot equality).
    const colOffsets = useMemo(() => buildColOffsets(cols, sheet?.colWidths), [cols, sheet?.colWidths])
    const contentWidth = colOffsets[cols]
    const contentHeight = rows * CELL_HEIGHT

    // Column resize: hooked here so the dragState (and the per-handle
    // pointer/touch handlers) can be passed down to ColumnHeader and
    // the body's preview line. Commits (and autosize) are wired
    // through to the Y.Doc here so the gesture hook stays
    // platform-only and unaware of the doc shape.
    const onResizeCommit = useCallback(
        (col: number, width: number) => {
            setYColWidth(doc, sheetId, col, width)
        },
        [doc, sheetId]
    )
    const onAutosize = useCallback(
        (col: number) => {
            runAutosize(doc, sheetId, col, onResizeCommit)
        },
        [doc, sheetId, onResizeCommit]
    )
    const [handleMenu, setHandleMenu] = useState<{ col: number; cursor: { x: number; y: number } } | null>(null)
    const onRequestHandleMenu = useCallback(
        (col: number, x: number, y: number) => {
            if (readOnly) return
            setHandleMenu({ col, cursor: { x, y } })
        },
        [readOnly]
    )
    const closeHandleMenu = useCallback(() => setHandleMenu(null), [])
    const { dragState, makeHandleProps } = useColumnResize({
        colWidths: sheet?.colWidths,
        readOnly,
        onCommit: onResizeCommit,
        onAutosize,
        onRequestMenu: onRequestHandleMenu,
    })

    // Viewport metrics: scroll position and measured size collapsed
    // into a single state so changes don't fan out into 4 separate
    // setState round-trips per scroll/layout event.
    const [viewport, setViewport] = useState<Viewport>({
        scrollX: 0,
        scrollY: 0,
        width: 0,
        height: 0,
    })

    const [selected, setSelected] = useState<SelectedCell | null>(null)
    // editSession unifies "which cell is being edited" + "its in-progress
    // draft". Lifted to Grid so the in-cell editor and the formula bar
    // share one source of truth — typing in either updates the same
    // draft and peer awareness, and one Enter/blur commits both views.
    const [editSession, setEditSession] = useState<EditSession | null>(null)
    // Which input most recently held focus. Drives suggestion-popover
    // anchoring (formula bar coords vs. editing-cell coords).
    const [activeSurface, setActiveSurface] = useState<ActiveSurface>('cell')
    // Suggestion popover state. selectedIndex is reset to 0 whenever
    // the items list changes (driven by the draft+cursor parser).
    const [suggestionIndex, setSuggestionIndex] = useState(0)
    // Layout rect of the formula bar's TextInput, captured on layout so
    // the popover knows where to anchor when activeSurface === 'bar'.
    const [formulaBarRect, setFormulaBarRect] = useState<{
        left: number
        top: number
        width: number
        height: number
    } | null>(null)
    // Active range drag (cell-ref insertion). Null when no drag in
    // progress. Stays null on a single tap — single taps insert a ref
    // immediately and don't enter drag mode.
    const [refDrag, setRefDrag] = useState<RefDrag | null>(null)
    const formulaBarInputRef = useRef<TextInput>(null)
    const cellEditorInputRef = useRef<TextInput>(null)
    // Tracks the last-inserted ref slice from a single-tap insertion,
    // so a follow-up tap on a different cell extends rather than
    // appending. Reset on commit/cancel/keystroke that isn't a ref op.
    const lastRefSliceRef = useRef<{ start: number; end: number } | null>(null)

    const functionNames = useFormulaFunctionNames()

    // publishLocal writes the consumer-shaped awareness slot. Called
    // by every handler that changes selection/editing rather than via
    // a sync-via-effect: pairing useState with useEffect to mirror
    // state into Awareness is the exact anti-pattern CLAUDE.md flags
    // ("if you find yourself pairing useState with useEffect to sync
    // or transform data…").
    const publishLocal = useCallback(
        (next: { selection: SelectedCell | null; editing: { row: number; col: number; draft: string } | null }) => {
            const local = awareness.getLocalState() ?? {}
            awareness.setLocalState({
                ...local,
                sheetId,
                selection: next.selection,
                editing: next.editing,
            })
        },
        [awareness, sheetId]
    )

    const onSelectCell = useCallback(
        (cell: SelectedCell) => {
            setSelected(cell)
            setEditSession(null)
            setPendingSelection(null)
            lastRefSliceRef.current = null
            publishLocal({ selection: cell, editing: null })
        },
        [publishLocal]
    )

    // Cursor selection is split off from editSession to avoid two
    // problems:
    //   1. Re-rendering the input with a controlled `selection` prop on
    //      every keystroke fights the native cursor — the prop wins
    //      and snaps the caret back to the stale value because
    //      onChangeText fires before onSelectionChange.
    //   2. Storing it in a ref (instead of state) lets every callback
    //      that needs to read the current cursor (autocomplete, ref
    //      insertion) get the up-to-date value without forcing
    //      re-renders on every selection change.
    //
    // For programmatic inserts we set pendingSelection state, which
    // the input applies once via the controlled `selection` prop, then
    // clears on the next onSelectionChange callback.
    const editCursorRef = useRef<DraftSelection>({ start: 0, end: 0 })
    const [pendingSelection, setPendingSelection] = useState<DraftSelection | null>(null)

    const onEditCell = useCallback(
        (cell: SelectedCell, initialDraft = '') => {
            if (readOnly) return
            const cursor = initialDraft.length
            setSelected(cell)
            editCursorRef.current = { start: cursor, end: cursor }
            setPendingSelection({ start: cursor, end: cursor })
            setEditSession({
                row: cell.row,
                col: cell.col,
                draft: initialDraft,
            })
            setActiveSurface('cell')
            lastRefSliceRef.current = null
            publishLocal({
                selection: cell,
                editing: { row: cell.row, col: cell.col, draft: initialDraft },
            })
        },
        [readOnly, publishLocal]
    )

    const onEditDraftChange = useCallback(
        (row: number, col: number, draft: string) => {
            // Manual typing supersedes any pending ref-tap insertion;
            // the slice memo would otherwise mis-replace user text.
            lastRefSliceRef.current = null
            // When this is the first draft change for a fresh edit
            // session (no prior session, or session targeted a different
            // cell), snap the cursor to the end of the draft. Without
            // this the cursor ref carries the position from a previous
            // edit and downstream consumers (autocomplete dropdown, cell-
            // ref insertion) read a stale value before the browser's
            // selectionchange event refreshes it. For mid-edit value
            // changes we leave the ref alone — onEditSelectionChange
            // will update it from the input's real selection.
            const prevSession = editSessionRowColRef.current
            const isFreshSession = prevSession == null || prevSession.row !== row || prevSession.col !== col
            if (isFreshSession || editCursorRef.current.end > draft.length) {
                editCursorRef.current = { start: draft.length, end: draft.length }
            }
            setEditSession((prev) => {
                if (prev != null && prev.row === row && prev.col === col && prev.draft === draft) return prev
                return { row, col, draft }
            })
            publishLocal({ selection: { row, col }, editing: { row, col, draft } })
        },
        [publishLocal]
    )

    const onEditSelectionChange = useCallback((row: number, col: number, start: number, end: number) => {
        // Update the cursor ref so callbacks read the live value, but
        // don't store in state — selection-only changes shouldn't
        // re-render every cell. Clear any pending controlled-selection
        // override now that the input has reported its actual cursor.
        if (editSessionRowColRef.current?.row !== row || editSessionRowColRef.current?.col !== col) return
        editCursorRef.current = { start, end }
        setPendingSelection((prev) => (prev == null ? prev : null))
    }, [])

    // Tracks (row, col) of the active edit session so the
    // selection-change callback can guard without depending on
    // editSession state (which would re-create the callback every
    // keystroke and thrash the controlled input).
    const editSessionRowColRef = useRef<SelectedCell | null>(null)
    useEffect(() => {
        editSessionRowColRef.current = editSession ? { row: editSession.row, col: editSession.col } : null
    }, [editSession])

    const onCommitEdit = useCallback(
        (row: number, col: number, value: string) => {
            if (readOnly) {
                setEditSession(null)
                setPendingSelection(null)
                lastRefSliceRef.current = null
                publishLocal({ selection: { row, col }, editing: null })
                return
            }
            setYCell(doc, sheetId, row, col, value)
            setEditSession(null)
            setPendingSelection(null)
            lastRefSliceRef.current = null
            publishLocal({ selection: { row, col }, editing: null })
        },
        [doc, sheetId, readOnly, publishLocal]
    )

    const onCancelEdit = useCallback(() => {
        const cell = selected
        setEditSession(null)
        setPendingSelection(null)
        lastRefSliceRef.current = null
        publishLocal({ selection: cell, editing: null })
    }, [selected, publishLocal])

    const horizontalRef = useRef<ScrollView>(null)
    const verticalRef = useRef<ScrollView>(null)
    const headerScrollRef = useRef<ScrollView>(null)
    const leftColumnScrollRef = useRef<ScrollView>(null)

    useImperativeHandle(
        ref,
        () => ({
            scrollToCell: (row: number, col: number) => {
                const x = colOffsets[Math.max(0, col - 1)] ?? 0
                const y = (row - 1) * CELL_HEIGHT
                horizontalRef.current?.scrollTo({ x, animated: true })
                verticalRef.current?.scrollTo({ y, animated: true })
            },
        }),
        [colOffsets]
    )

    const visible = useMemo(() => {
        if (viewport.width === 0 || viewport.height === 0) {
            return { firstRow: 1, lastRow: 0, firstCol: 1, lastCol: 0 }
        }
        const firstRow = Math.max(1, Math.floor(viewport.scrollY / CELL_HEIGHT) + 1 - OVERSCAN)
        const lastRow = Math.min(rows, Math.ceil((viewport.scrollY + viewport.height) / CELL_HEIGHT) + OVERSCAN)
        // Variable-width columns: binary search the prefix sums for the
        // first/last visible column. Overscan is applied as a column
        // count, not a pixel padding — the only requirement is that the
        // visible window slightly extends beyond the viewport so newly
        // scrolled-in cells render before they're seen.
        const rawFirstCol = firstColAtOffset(colOffsets, viewport.scrollX)
        const rawLastCol = lastColAtOffset(colOffsets, viewport.scrollX + viewport.width)
        const firstCol = Math.max(1, rawFirstCol - OVERSCAN)
        const lastCol = Math.min(cols, rawLastCol + OVERSCAN)
        return { firstRow, lastRow, firstCol, lastCol }
    }, [viewport, rows, cols, colOffsets])

    const onHorizontalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x
        setViewport((v) => (v.scrollX === x ? v : { ...v, scrollX: x }))
        // Mirror to the column header so it stays aligned with the body.
        // Using a ref + scrollTo (rather than absolute-positioning the
        // header inside the body's content) keeps the header in its own
        // sticky region so it doesn't get clipped by row windowing.
        headerScrollRef.current?.scrollTo({ x, animated: false })
    }, [])

    const onVerticalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y
        setViewport((v) => (v.scrollY === y ? v : { ...v, scrollY: y }))
        leftColumnScrollRef.current?.scrollTo({ y, animated: false })
    }, [])

    const onBodyLayout = useCallback((e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout
        setViewport((v) => (v.width === width && v.height === height ? v : { ...v, width, height }))
    }, [])

    const presence = usePresence(awareness)
    const presenceOnSheet = useMemo(() => presence.filter((p) => p.sheetId === sheetId), [presence, sheetId])

    const onToggleBold = useCallback(() => {
        if (selected == null || readOnly) return
        const current = readCellStyle(doc, sheetId, selected.row, selected.col)
        const nextBold = current?.font?.bold !== true
        setYCellStyle(doc, sheetId, selected.row, selected.col, { font: { bold: nextBold } })
    }, [doc, sheetId, selected, readOnly])

    const onToggleItalic = useCallback(() => {
        if (selected == null || readOnly) return
        const current = readCellStyle(doc, sheetId, selected.row, selected.col)
        const nextItalic = current?.font?.italic !== true
        setYCellStyle(doc, sheetId, selected.row, selected.col, { font: { italic: nextItalic } })
    }, [doc, sheetId, selected, readOnly])

    // Subscribe to the selected cell so the toolbar's active state and
    // the formula bar's value re-render when the cell changes (locally
    // or via a peer). Passing null row/col would force useYCell to
    // observe a synthetic key — instead we early-out via doc==null when
    // there's no selection by keying the call on row/col 0,0 and
    // treating the result as "no selection" downstream.
    const selectedCellValue = useYCell(doc, sheetId, selected?.row ?? 0, selected?.col ?? 0)
    const isBold = selected != null && selectedCellValue?.style?.font?.bold === true
    const isItalic = selected != null && selectedCellValue?.style?.font?.italic === true

    // The formula bar shows the user-input form when typing (the
    // editSession draft), the formula text for formula cells, or the
    // displayed value otherwise. For formula cells we surface the
    // expression rather than the cached result so editing a formula
    // round-trips its formula text.
    const formulaBarValue = computeFormulaBarValue(editSession, selectedCellValue, selected != null)
    const formulaBarLabel = selected != null ? `${columnLabel(selected.col)}${selected.row}` : null

    const onFormulaChange = useCallback(
        (next: string) => {
            if (selected == null || readOnly) return
            // First keystroke into the formula bar implicitly opens an
            // edit session — there's no "click to edit" step in the
            // formula bar UX. Subsequent keystrokes update the same
            // draft and propagate to peers via awareness.
            onEditDraftChange(selected.row, selected.col, next)
        },
        [selected, readOnly, onEditDraftChange]
    )

    const onFormulaCommit = useCallback(() => {
        if (editSession == null) return
        onCommitEdit(editSession.row, editSession.col, editSession.draft)
    }, [editSession, onCommitEdit])

    const onFormulaCancel = useCallback(() => {
        onCancelEdit()
    }, [onCancelEdit])

    // Suggestion popover state derived from the current draft + cursor.
    // Memoized so a stable items array reaches FormulaSuggestionList
    // between renders that don't change the token.
    const suggestionState = useMemo(() => {
        if (editSession == null) return { items: [] as string[] }
        if (functionNames.length === 0) return { items: [] as string[] }
        const t = parseFunctionToken(editSession.draft, editCursorRef.current.end)
        if (t == null) return { items: [] as string[] }
        const items = filterFunctions(functionNames, t.token)
        if (items.length === 0) return { items: [] as string[] }
        return { items }
    }, [editSession, functionNames])

    // biome-ignore lint/correctness/useExhaustiveDependencies: items array identity is the trigger
    useEffect(() => {
        setSuggestionIndex(0)
    }, [suggestionState.items])

    // Track the draft at which the popover was Esc-dismissed so it
    // stays hidden until the user types something different — typical
    // autocomplete UX.
    const [dismissedDraft, setDismissedDraft] = useState<string | null>(null)
    useEffect(() => {
        if (editSession == null) {
            if (dismissedDraft != null) setDismissedDraft(null)
            return
        }
        if (dismissedDraft != null && editSession.draft !== dismissedDraft) {
            setDismissedDraft(null)
        }
    }, [editSession, dismissedDraft])

    const popoverOpen = editSession != null && suggestionState.items.length > 0 && dismissedDraft !== editSession.draft

    const insertFunctionSuggestion = useCallback(
        (fnName: string) => {
            if (editSession == null) return
            const t = parseFunctionToken(editSession.draft, editCursorRef.current.end)
            if (t == null) return
            const result = applyFunctionInsertion(editSession.draft, t, fnName)
            editCursorRef.current = result.selection
            setPendingSelection(result.selection)
            setEditSession({
                row: editSession.row,
                col: editSession.col,
                draft: result.draft,
            })
            lastRefSliceRef.current = null
            publishLocal({
                selection: { row: editSession.row, col: editSession.col },
                editing: { row: editSession.row, col: editSession.col, draft: result.draft },
            })
        },
        [editSession, publishLocal]
    )

    const onSpecialKey = useCallback(
        (key: FormulaSpecialKey): boolean => {
            if (editSession == null) return false
            if (!popoverOpen) return false
            if (key === 'ArrowDown') {
                setSuggestionIndex((i) => (i + 1) % suggestionState.items.length)
                return true
            }
            if (key === 'ArrowUp') {
                setSuggestionIndex((i) => (i - 1 + suggestionState.items.length) % suggestionState.items.length)
                return true
            }
            if (key === 'Tab' || key === 'Enter') {
                insertFunctionSuggestion(suggestionState.items[suggestionIndex])
                return true
            }
            if (key === 'Escape') {
                setDismissedDraft(editSession.draft)
                return true
            }
            return false
        },
        [editSession, popoverOpen, suggestionState.items, suggestionIndex, insertFunctionSuggestion]
    )

    // Cell-ref insertion (single tap): when the user taps a cell while
    // editing a formula and the cursor is in a ref-acceptable position,
    // splice the address into the draft instead of moving selection.
    const onCellRefTap = useCallback(
        (row: number, col: number): boolean => {
            if (editSession == null) return false
            if (!isRefAcceptable(editSession.draft, editCursorRef.current.end)) return false
            const ref = formatRef(row, col)
            const prevSlice = lastRefSliceRef.current
            const result =
                prevSlice != null
                    ? extendCellRefInsertion(editSession.draft, prevSlice, ref)
                    : applyCellRefInsertion(editSession.draft, editCursorRef.current.end, ref)
            lastRefSliceRef.current = result.insertedSlice
            editCursorRef.current = result.selection
            setPendingSelection(result.selection)
            setEditSession({
                row: editSession.row,
                col: editSession.col,
                draft: result.draft,
            })
            publishLocal({
                selection: { row: editSession.row, col: editSession.col },
                editing: { row: editSession.row, col: editSession.col, draft: result.draft },
            })
            const target = activeSurface === 'bar' ? formulaBarInputRef.current : cellEditorInputRef.current
            target?.focus()
            return true
        },
        [editSession, activeSurface, publishLocal]
    )

    const onCellRefDragStart = useCallback(
        (row: number, col: number): boolean => {
            if (editSession == null) return false
            if (!isRefAcceptable(editSession.draft, editCursorRef.current.end)) return false
            const ref = formatRef(row, col)
            const prevSlice = lastRefSliceRef.current
            const result =
                prevSlice != null
                    ? extendCellRefInsertion(editSession.draft, prevSlice, ref)
                    : applyCellRefInsertion(editSession.draft, editCursorRef.current.end, ref)
            lastRefSliceRef.current = result.insertedSlice
            editCursorRef.current = result.selection
            setPendingSelection(result.selection)
            setEditSession({
                row: editSession.row,
                col: editSession.col,
                draft: result.draft,
            })
            setRefDrag({
                anchor: { row, col },
                end: { row, col },
                lastSlice: result.insertedSlice,
            })
            publishLocal({
                selection: { row: editSession.row, col: editSession.col },
                editing: { row: editSession.row, col: editSession.col, draft: result.draft },
            })
            return true
        },
        [editSession, publishLocal]
    )

    const onCellRefDragMove = useCallback((row: number, col: number) => {
        setRefDrag((drag) => {
            if (drag == null) return drag
            if (drag.end.row === row && drag.end.col === col) return drag
            return { ...drag, end: { row, col } }
        })
    }, [])

    const onCellRefDragEnd = useCallback(() => {
        setRefDrag(null)
        const target = activeSurface === 'bar' ? formulaBarInputRef.current : cellEditorInputRef.current
        target?.focus()
    }, [activeSurface])

    // Live-update the draft as the drag end-cell changes. Effect keeps
    // the move handler's dep list small (otherwise every keystroke would
    // re-create it).
    useEffect(() => {
        if (refDrag == null) return
        if (editSession == null) return
        const range = formatRange(refDrag.anchor, refDrag.end)
        const result = extendCellRefInsertion(editSession.draft, refDrag.lastSlice, range)
        if (result.draft === editSession.draft) return
        lastRefSliceRef.current = result.insertedSlice
        editCursorRef.current = result.selection
        setPendingSelection(result.selection)
        setEditSession({
            row: editSession.row,
            col: editSession.col,
            draft: result.draft,
        })
        setRefDrag((drag) => (drag == null ? drag : { ...drag, lastSlice: result.insertedSlice }))
        publishLocal({
            selection: { row: editSession.row, col: editSession.col },
            editing: { row: editSession.row, col: editSession.col, draft: result.draft },
        })
    }, [refDrag, editSession, publishLocal])

    const onSuggestionSelect = useCallback(
        (item: string) => {
            insertFunctionSuggestion(item)
        },
        [insertFunctionSuggestion]
    )

    const onSuggestionHover = useCallback((index: number) => {
        setSuggestionIndex(index)
    }, [])

    const onFormulaBarFocus = useCallback(() => {
        setActiveSurface('bar')
    }, [])

    const onCellEditorFocus = useCallback(() => {
        setActiveSurface('cell')
    }, [])

    const onFormulaBarSelectionChange = useCallback(
        (start: number, end: number) => {
            if (editSession == null) return
            onEditSelectionChange(editSession.row, editSession.col, start, end)
        },
        [editSession, onEditSelectionChange]
    )

    const onFormulaBarAnchorLayout = useCallback(
        (rect: { left: number; top: number; width: number; height: number }) => {
            setFormulaBarRect(rect)
        },
        []
    )

    // Only forward a controlled `selection` to the inputs when we just
    // performed a programmatic insertion (function autocomplete or
    // cell-ref tap/drag). For normal typing we leave `selection`
    // undefined so the input owns its own caret — passing it on every
    // render would yank the caret back to the previous keystroke's
    // position because onChangeText fires before onSelectionChange.
    const formulaBarSelection = pendingSelection ?? undefined

    // Suggestion popover anchor in Grid coords. The Toolbar + FormulaBar
    // each occupy a 28-px row at the top, then the column header (28 px).
    // Below that the Body's vertical scroll begins. The cell anchor uses
    // colOffsets (variable widths).
    const suggestionAnchor = useMemo(() => {
        if (!popoverOpen || editSession == null) return null
        if (activeSurface === 'bar') {
            if (formulaBarRect == null) return null
            return {
                left: ROW_HEADER_WIDTH + formulaBarRect.left,
                top: TOOLBAR_HEIGHT + FORMULA_BAR_HEIGHT,
                width: Math.min(220, Math.max(140, formulaBarRect.width)),
            }
        }
        const colLeft = colOffsets[editSession.col - 1] ?? 0
        return {
            left: ROW_HEADER_WIDTH + colLeft - viewport.scrollX,
            top: TOOLBAR_HEIGHT + FORMULA_BAR_HEIGHT + HEADER_HEIGHT + editSession.row * CELL_HEIGHT - viewport.scrollY,
            width: 220,
        }
    }, [popoverOpen, editSession, activeSurface, formulaBarRect, colOffsets, viewport.scrollX, viewport.scrollY])

    // Single Menu mount per Grid. The right-clicked / long-pressed cell
    // is captured via a callback dispatched up from Cell, and the Menu
    // is positioned at the cursor/touch coordinates via triggerPosition.
    // This avoids per-cell <Menu> mounts (which would break <Cell>'s
    // memoization and balloon DOM nodes in a windowed grid).
    const [contextTarget, setContextTarget] = useState<{
        cell: SelectedCell
        cursor: { x: number; y: number }
    } | null>(null)

    const onCellContextMenu = useCallback(
        (row: number, col: number, x: number, y: number) => {
            // Match single-click behaviour: a context-menu gesture also
            // selects the cell. Skip edit so the menu doesn't open over
            // a TextInput.
            setSelected({ row, col })
            setEditSession(null)
            publishLocal({ selection: { row, col }, editing: null })
            setContextTarget({ cell: { row, col }, cursor: { x, y } })
        },
        [publishLocal]
    )

    const closeContextMenu = useCallback(() => setContextTarget(null), [])

    return (
        <View className="flex-1 bg-background">
            <Toolbar
                disabled={readOnly || selected == null}
                isBold={isBold}
                isItalic={isItalic}
                canUndo={undoState.canUndo}
                canRedo={undoState.canRedo}
                onToggleBold={onToggleBold}
                onToggleItalic={onToggleItalic}
                onUndo={undoState.undo}
                onRedo={undoState.redo}
            />
            <FormulaBar
                ref={formulaBarInputRef}
                cellLabel={formulaBarLabel}
                value={formulaBarValue}
                selection={formulaBarSelection}
                disabled={readOnly || selected == null}
                onChange={onFormulaChange}
                onSelectionChange={onFormulaBarSelectionChange}
                onCommit={onFormulaCommit}
                onCancel={onFormulaCancel}
                onFocus={onFormulaBarFocus}
                onSpecialKey={onSpecialKey}
                onAnchorLayout={onFormulaBarAnchorLayout}
            />
            <View className="flex-row">
                <CornerCell />
                <ColumnHeader
                    scrollRef={headerScrollRef}
                    contentWidth={contentWidth}
                    colOffsets={colOffsets}
                    firstCol={visible.firstCol}
                    lastCol={visible.lastCol}
                    activeCol={selected?.col ?? null}
                    makeHandleProps={makeHandleProps}
                    dragState={dragState}
                />
            </View>
            <View className="flex-1 flex-row">
                <RowHeader
                    scrollRef={leftColumnScrollRef}
                    contentHeight={contentHeight}
                    firstRow={visible.firstRow}
                    lastRow={visible.lastRow}
                    activeRow={selected?.row ?? null}
                />
                <Body
                    horizontalRef={horizontalRef}
                    verticalRef={verticalRef}
                    contentWidth={contentWidth}
                    contentHeight={contentHeight}
                    colOffsets={colOffsets}
                    dragState={dragState}
                    visible={visible}
                    sheet={sheet}
                    selected={selected}
                    editSession={editSession}
                    pendingSelection={pendingSelection}
                    cellEditorAutoFocus={activeSurface === 'cell'}
                    cellEditorInputRef={cellEditorInputRef}
                    refDrag={refDrag}
                    presenceOnSheet={presenceOnSheet}
                    onSelect={onSelectCell}
                    onEdit={onEditCell}
                    onEditDraftChange={onEditDraftChange}
                    onEditSelectionChange={onEditSelectionChange}
                    onCommitEdit={onCommitEdit}
                    onCancelEdit={onCancelEdit}
                    onCellRefTap={onCellRefTap}
                    onCellRefDragStart={onCellRefDragStart}
                    onCellRefDragMove={onCellRefDragMove}
                    onCellRefDragEnd={onCellRefDragEnd}
                    onCellEditorFocus={onCellEditorFocus}
                    onSpecialKey={onSpecialKey}
                    onLayout={onBodyLayout}
                    onHorizontalScroll={onHorizontalScroll}
                    onVerticalScroll={onVerticalScroll}
                    onCellContextMenu={readOnly ? undefined : onCellContextMenu}
                />
            </View>
            <CellContextMenu target={contextTarget} doc={doc} sheetId={sheetId} onClose={closeContextMenu} />
            <HandleContextMenu
                target={handleMenu}
                onAutosize={onAutosize}
                onReset={onResizeCommit}
                onClose={closeHandleMenu}
            />
            <FormulaSuggestionList
                items={suggestionState.items}
                selectedIndex={suggestionIndex}
                anchor={suggestionAnchor}
                onSelect={onSuggestionSelect}
                onHover={onSuggestionHover}
            />
        </View>
    )
})

// computeFormulaBarValue picks the right text to display in the
// formula bar:
//   - while editing, show the in-progress draft
//   - for formula cells, show the formula expression (so editing
//     round-trips the formula text rather than its cached result)
//   - otherwise, show the same string the cell renders
function computeFormulaBarValue(
    editSession: EditSession | null,
    cell: ReturnType<typeof useYCell>,
    hasSelection: boolean
): string {
    if (editSession != null) return editSession.draft
    if (!hasSelection || cell == null) return ''
    if (cell.kind === 'formula' && cell.formula) {
        return cell.formula
    }
    return formatCell(cell.kind, cell.raw, cell.formula)
}

// readCellStyle is a one-shot read of a cell's style from the Y.Doc.
// Used by handlers that need the current value to compute a toggle —
// can't use the useYCell hook from inside a callback, and subscribing
// the whole Grid to every cell change just to know whether bold is on
// would be wasteful.
function readCellStyle(doc: Y.Doc | null, sheetId: string, row: number, col: number) {
    if (doc == null) return undefined
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)
}

function CornerCell() {
    return (
        <View
            className="bg-surface-secondary border-r border-b border-border"
            style={{ width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }}
        />
    )
}

interface ColumnHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentWidth: number
    colOffsets: Float64Array
    firstCol: number
    lastCol: number
    activeCol: number | null
    makeHandleProps: (col: number) => Record<string, unknown>
    dragState: DragState | null
}

function ColumnHeader({
    scrollRef,
    contentWidth,
    colOffsets,
    firstCol,
    lastCol,
    activeCol,
    makeHandleProps,
    dragState,
}: ColumnHeaderProps) {
    const cells: React.ReactNode[] = []
    for (let col = firstCol; col <= lastCol; col++) {
        const isActive = col === activeCol
        const left = colOffsets[col - 1]
        const width = colOffsets[col] - left
        // Hidden columns (width 0 from a drag-to-zero) still need to
        // occupy zero pixels of layout space — render nothing rather
        // than a 0×H view to keep the DOM lean.
        if (width > 0) {
            cells.push(
                <View
                    key={`h-${col}`}
                    className={`border-r border-b border-border items-center justify-center ${
                        isActive ? 'bg-accent' : 'bg-surface-secondary'
                    }`}
                    style={{
                        position: 'absolute',
                        left,
                        top: 0,
                        width,
                        height: HEADER_HEIGHT,
                        ...(isActive ? ACTIVE_HEADER_INSET_STYLE : null),
                    }}
                >
                    <Text
                        className={`text-xs ${isActive ? 'text-accent-foreground' : 'text-muted-foreground'}`}
                        style={isActive ? { fontWeight: 'bold' } : undefined}
                    >
                        {columnLabel(col)}
                    </Text>
                </View>
            )
        }
        // Resize handle straddles the right boundary of column `col`.
        // Position it at left+width-half so it visually sits ON the
        // boundary line. On native we also enlarge the touchable
        // area beyond the visible 6px stripe via hitSlop equivalent
        // (a wider transparent View extending into both columns).
        const handleX = left + width - HANDLE_VISUAL_WIDTH / 2
        const isDraggingThis = dragState?.col === col
        cells.push(
            <View
                key={`g-${col}`}
                {...makeHandleProps(col)}
                style={
                    {
                        position: 'absolute',
                        left: handleX - (Platform.OS === 'web' ? 0 : NATIVE_HANDLE_HIT_SLOP),
                        top: 0,
                        width: HANDLE_VISUAL_WIDTH + (Platform.OS === 'web' ? 0 : NATIVE_HANDLE_HIT_SLOP * 2),
                        height: HEADER_HEIGHT,
                        zIndex: 2,
                        // Web-only cursor affordance. RN-Web compiles
                        // unrecognized style keys to inline CSS, so this
                        // forwards through. Native doesn't have a cursor
                        // concept; the wider hit slop is the affordance.
                        cursor: 'col-resize',
                        // Subtle visible bar centered on the handle so the
                        // grab target is discoverable on hover; flat (no
                        // border) when not dragged so it doesn't compete
                        // with the column-divider line that's already
                        // there.
                        backgroundColor: isDraggingThis ? '#22a06b' : 'transparent',
                        // biome-ignore lint/suspicious/noExplicitAny: web-only cursor key on RN ViewStyle
                    } as any
                }
            />
        )
    }
    // Outer flex-1 wrapper sets the visible width (= viewport-sized clip
    // region); the ScrollView fills it. We can't put `flex: 1` directly on
    // the ScrollView because RN-Web's ScrollView ships `flex: 1 1 auto`
    // and inline `width` on the same node loses to flex sizing.
    return (
        <View style={{ flex: 1, height: HEADER_HEIGHT, overflow: 'hidden' }}>
            <ScrollView
                ref={scrollRef}
                horizontal
                scrollEnabled={false}
                showsHorizontalScrollIndicator={false}
                style={{ height: HEADER_HEIGHT }}
                contentContainerStyle={{ width: contentWidth, height: HEADER_HEIGHT }}
            >
                {cells}
            </ScrollView>
        </View>
    )
}

interface RowHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentHeight: number
    firstRow: number
    lastRow: number
    activeRow: number | null
}

function RowHeader({ scrollRef, contentHeight, firstRow, lastRow, activeRow }: RowHeaderProps) {
    const cells: React.ReactNode[] = []
    for (let row = firstRow; row <= lastRow; row++) {
        const isActive = row === activeRow
        cells.push(
            <View
                key={row}
                className={`border-r border-b border-border items-center justify-center ${
                    isActive ? 'bg-accent' : 'bg-surface-secondary'
                }`}
                style={{
                    position: 'absolute',
                    left: 0,
                    top: (row - 1) * CELL_HEIGHT,
                    width: ROW_HEADER_WIDTH,
                    height: CELL_HEIGHT,
                    ...(isActive ? ACTIVE_HEADER_INSET_STYLE : null),
                }}
            >
                <Text
                    className={`text-xs ${isActive ? 'text-accent-foreground' : 'text-muted-foreground'}`}
                    style={isActive ? { fontWeight: 'bold' } : undefined}
                >
                    {row}
                </Text>
            </View>
        )
    }
    return (
        <View style={{ width: ROW_HEADER_WIDTH, overflow: 'hidden' }}>
            <ScrollView
                ref={scrollRef}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ width: ROW_HEADER_WIDTH, height: contentHeight }}
            >
                {cells}
            </ScrollView>
        </View>
    )
}

interface BodyProps {
    horizontalRef: React.RefObject<ScrollView | null>
    verticalRef: React.RefObject<ScrollView | null>
    contentWidth: number
    contentHeight: number
    colOffsets: Float64Array
    dragState: DragState | null
    visible: { firstRow: number; lastRow: number; firstCol: number; lastCol: number }
    sheet: SheetWithId | null
    selected: SelectedCell | null
    editSession: EditSession | null
    pendingSelection: DraftSelection | null
    cellEditorAutoFocus: boolean
    cellEditorInputRef: React.RefObject<TextInput | null>
    refDrag: RefDrag | null
    presenceOnSheet: RemotePresence[]
    onSelect: (cell: SelectedCell) => void
    onEdit: (cell: SelectedCell) => void
    onEditDraftChange: (row: number, col: number, draft: string) => void
    onEditSelectionChange: (row: number, col: number, start: number, end: number) => void
    onCommitEdit: (row: number, col: number, value: string) => void
    onCancelEdit: () => void
    // Returns true when the tap/drag handled the gesture as a ref
    // insertion. The Cell uses this to skip its select/edit fallback.
    onCellRefTap: (row: number, col: number) => boolean
    onCellRefDragStart: (row: number, col: number) => boolean
    onCellRefDragMove: (row: number, col: number) => void
    onCellRefDragEnd: () => void
    onCellEditorFocus: () => void
    onSpecialKey: (key: FormulaSpecialKey) => boolean
    onLayout: (e: LayoutChangeEvent) => void
    onHorizontalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onVerticalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onCellContextMenu?: (row: number, col: number, x: number, y: number) => void
}

function Body({
    horizontalRef,
    verticalRef,
    contentWidth,
    contentHeight,
    colOffsets,
    dragState,
    visible,
    sheet,
    selected,
    editSession,
    pendingSelection,
    cellEditorAutoFocus,
    cellEditorInputRef,
    refDrag,
    presenceOnSheet,
    onSelect,
    onEdit,
    onEditDraftChange,
    onEditSelectionChange,
    onCommitEdit,
    onCancelEdit,
    onCellRefTap,
    onCellRefDragStart,
    onCellRefDragMove,
    onCellRefDragEnd,
    onCellEditorFocus,
    onSpecialKey,
    onLayout,
    onHorizontalScroll,
    onVerticalScroll,
    onCellContextMenu,
}: BodyProps) {
    const sheetId = sheet?.id ?? ''

    // Map "row:col" → first remote editor occupying that cell. Lifted
    // out of <Cell> so cells don't subscribe to presence individually
    // (one subscription per visible cell would re-render the whole
    // viewport on every keystroke from any peer).
    const remoteEditingByCell = useMemo(() => {
        const m = new Map<string, RemotePresence>()
        for (const p of presenceOnSheet) {
            if (p.editing == null) continue
            m.set(`${p.editing.row}:${p.editing.col}`, p)
        }
        return m
    }, [presenceOnSheet])

    const cells: React.ReactNode[] = []
    if (sheet != null) {
        for (let row = visible.firstRow; row <= visible.lastRow; row++) {
            for (let col = visible.firstCol; col <= visible.lastCol; col++) {
                const left = colOffsets[col - 1]
                const width = colOffsets[col] - left
                // Hidden columns: skip rendering entirely. The visible
                // range still covers them (for keyboard nav consistency)
                // but we don't paint a 0×H Pressable.
                if (width <= 0) continue
                const isEditing = editSession?.row === row && editSession?.col === col
                const isSelected = selected?.row === row && selected?.col === col
                const remoteEditor = remoteEditingByCell.get(`${row}:${col}`) ?? null
                // editingDraft is only passed to the cell that owns the
                // edit session — this keeps Cell.memo equality stable
                // for non-editing cells (passing the draft to every
                // cell would invalidate every memoization on each
                // keystroke).
                const editingDraft = isEditing ? editSession.draft : ''
                const editingSelection = isEditing ? pendingSelection ?? undefined : undefined
                cells.push(
                    <Cell
                        key={`${row}:${col}`}
                        sheetId={sheetId}
                        row={row}
                        col={col}
                        left={left}
                        width={width}
                        isSelected={isSelected}
                        isEditing={isEditing}
                        isAnyEditing={editSession != null}
                        editingDraft={editingDraft}
                        editingSelection={editingSelection}
                        cellEditorAutoFocus={cellEditorAutoFocus}
                        cellEditorInputRef={cellEditorInputRef}
                        remoteEditor={remoteEditor}
                        onSelect={onSelect}
                        onEdit={onEdit}
                        onEditDraftChange={onEditDraftChange}
                        onEditSelectionChange={onEditSelectionChange}
                        onCommitEdit={onCommitEdit}
                        onCancelEdit={onCancelEdit}
                        onCellRefTap={onCellRefTap}
                        onCellRefDragStart={onCellRefDragStart}
                        onCellRefDragMove={onCellRefDragMove}
                        onCellRefDragEnd={onCellRefDragEnd}
                        onCellEditorFocus={onCellEditorFocus}
                        onSpecialKey={onSpecialKey}
                        onContextMenu={onCellContextMenu}
                        colOffsets={colOffsets}
                    />
                )
            }
        }
    }

    const localSelectionOverlay = (() => {
        if (selected == null || editSession != null) return null
        const left = colOffsets[selected.col - 1] ?? 0
        const width = (colOffsets[selected.col] ?? left) - left
        if (width <= 0) return null
        return (
            <View
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left,
                    top: (selected.row - 1) * CELL_HEIGHT,
                    width,
                    height: CELL_HEIGHT,
                    borderWidth: 2,
                    borderColor: '#22a06b',
                }}
            />
        )
    })()

    // While a ref-drag is in progress, paint a translucent rectangle
    // over the chosen range so the user sees the selection they're
    // about to commit. Pointer-events disabled so it doesn't block the
    // pan gesture.
    const refDragOverlay = (() => {
        if (refDrag == null) return null
        const minRow = Math.min(refDrag.anchor.row, refDrag.end.row)
        const maxRow = Math.max(refDrag.anchor.row, refDrag.end.row)
        const minCol = Math.min(refDrag.anchor.col, refDrag.end.col)
        const maxCol = Math.max(refDrag.anchor.col, refDrag.end.col)
        const left = colOffsets[minCol - 1] ?? 0
        const right = colOffsets[maxCol] ?? left
        const width = right - left
        if (width <= 0) return null
        return (
            <View
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left,
                    top: (minRow - 1) * CELL_HEIGHT,
                    width,
                    height: (maxRow - minRow + 1) * CELL_HEIGHT,
                    borderWidth: 2,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.10)',
                }}
            />
        )
    })()

    const remoteOverlays = presenceOnSheet.flatMap((p) => {
        const out: React.ReactNode[] = []
        if (p.selection != null && p.editing == null) {
            out.push(
                <RemoteSelectionOverlay
                    key={`sel-${p.clientID}`}
                    row={p.selection.row}
                    col={p.selection.col}
                    colOffsets={colOffsets}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
        if (p.editing != null) {
            out.push(
                <RemoteSelectionOverlay
                    key={`edit-${p.clientID}`}
                    row={p.editing.row}
                    col={p.editing.col}
                    colOffsets={colOffsets}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
        return out
    })

    return (
        <View style={{ flex: 1, overflow: 'hidden' }} onLayout={onLayout}>
            <ScrollView
                ref={horizontalRef}
                horizontal
                onScroll={onHorizontalScroll}
                scrollEventThrottle={16}
                showsHorizontalScrollIndicator
                contentContainerStyle={{ width: contentWidth }}
            >
                <ScrollView
                    ref={verticalRef}
                    onScroll={onVerticalScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator
                    style={{ width: contentWidth }}
                    contentContainerStyle={{ width: contentWidth, height: contentHeight }}
                >
                    {cells}
                    {remoteOverlays}
                    {localSelectionOverlay}
                    {refDragOverlay}
                    <ResizePreviewLine dragState={dragState} colOffsets={colOffsets} contentHeight={contentHeight} />
                </ScrollView>
            </ScrollView>
        </View>
    )
}

interface CellProps {
    sheetId: string
    row: number
    col: number
    // Pre-computed by the parent so a width change in column N doesn't
    // invalidate every memoized cell — only this column's cells get
    // new left/width props.
    left: number
    width: number
    isSelected: boolean
    isEditing: boolean
    // True when ANY cell on the sheet is currently being edited. Used
    // by web cells to swallow mousedown so the input doesn't blur and
    // commit a half-formula before our ref-tap handler can insert.
    isAnyEditing: boolean
    editingDraft: string
    editingSelection: DraftSelection | undefined
    // True when this cell's editor should grab focus on mount. False when
    // editing was initiated from the formula bar — letting the editor
    // autoFocus would steal focus back to the cell, blur the formula bar,
    // and commit the half-typed value.
    cellEditorAutoFocus: boolean
    cellEditorInputRef: React.RefObject<TextInput | null>
    remoteEditor: RemotePresence | null
    colOffsets: Float64Array
    onSelect: (cell: SelectedCell) => void
    onEdit: (cell: SelectedCell, initialDraft?: string) => void
    onEditDraftChange: (row: number, col: number, draft: string) => void
    onEditSelectionChange: (row: number, col: number, start: number, end: number) => void
    onCommitEdit: (row: number, col: number, value: string) => void
    onCancelEdit: () => void
    // Returns true when the cell tap was handled as a ref insertion.
    // Cell uses this to skip the normal select/edit fallback.
    onCellRefTap: (row: number, col: number) => boolean
    onCellRefDragStart: (row: number, col: number) => boolean
    onCellRefDragMove: (row: number, col: number) => void
    onCellRefDragEnd: () => void
    onCellEditorFocus: () => void
    onSpecialKey: (key: FormulaSpecialKey) => boolean
    onContextMenu?: (row: number, col: number, x: number, y: number) => void
}

const Cell = memo(function Cell({
    sheetId,
    row,
    col,
    left,
    width,
    isSelected,
    isEditing,
    isAnyEditing,
    editingDraft,
    editingSelection,
    cellEditorAutoFocus,
    cellEditorInputRef,
    remoteEditor,
    colOffsets,
    onSelect,
    onEdit,
    onEditDraftChange,
    onEditSelectionChange,
    onCommitEdit,
    onCancelEdit,
    onCellRefTap,
    onCellRefDragStart,
    onCellRefDragMove,
    onCellRefDragEnd,
    onCellEditorFocus,
    onSpecialKey,
    onContextMenu,
}: CellProps) {
    const { doc } = useWorkbook()
    const cellValue = useYCell(doc, sheetId, row, col)
    // formatCell is the single source of truth for the visible string;
    // `display` on disk is still maintained as a cache for old peers
    // and the server-side serializer, but the live render computes from
    // (kind, raw) so future formatting (Phase 3 numFmt) lights up here
    // automatically.
    const display = cellValue == null ? '' : formatCell(cellValue.kind, cellValue.raw, cellValue.formula)
    // Editing a formula cell should preload the formula expression
    // (e.g. "=SUM(A1:A2)"), not its computed result. This matches how
    // the formula bar surfaces formula text and lets users round-trip
    // a formula edit without losing the expression.
    const editDraft = cellValue?.kind === 'formula' && cellValue.formula ? cellValue.formula : display

    const remoteDraft = remoteEditor?.editing?.draft

    const top = (row - 1) * CELL_HEIGHT

    if (isEditing) {
        return (
            <CellEditor
                inputRef={cellEditorInputRef}
                left={left}
                top={top}
                width={width}
                value={editingDraft}
                selection={editingSelection}
                autoFocus={cellEditorAutoFocus}
                onDraftChange={(draft) => onEditDraftChange(row, col, draft)}
                onSelectionChange={(start, end) => onEditSelectionChange(row, col, start, end)}
                onCommit={(value) => onCommitEdit(row, col, value)}
                onCancel={onCancelEdit}
                onFocus={onCellEditorFocus}
                onSpecialKey={onSpecialKey}
            />
        )
    }

    // When the user is editing a formula and taps this cell, intercept
    // the press to insert a ref instead of selecting/editing the cell.
    // onCellRefTap returns false (no-op) when the cursor isn't in a
    // ref-acceptable position, falling through to the normal select/
    // edit gesture.
    const onPress = () => {
        if (onCellRefTap(row, col)) return
        if (isSelected) {
            onEdit({ row, col }, editDraft)
        } else {
            onSelect({ row, col })
        }
    }

    // Pan handlers for drag-range insertion. The threshold lets simple
    // taps fall through to onPress (which routes to ref insertion or
    // select/edit). onCellRefDragStart returns false when the cursor
    // isn't in a ref-acceptable position; we still claim the gesture
    // here, which is fine — the drag is a no-op without a session.
    const panHandlers = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: () => {
            onCellRefDragStart(row, col)
        },
        onPanResponderMove: (e) => {
            const { locationX, locationY } = e.nativeEvent
            const gridX = left + locationX
            const gridY = top + locationY
            const target = locateCellAtGridCoord(gridX, gridY, colOffsets)
            if (target != null) onCellRefDragMove(target.row, target.col)
        },
        onPanResponderRelease: () => onCellRefDragEnd(),
        onPanResponderTerminate: () => onCellRefDragEnd(),
    }).panHandlers

    // Native long-press fires before any subsequent onPress is dispatched,
    // so wiring the context menu here doesn't conflict with the
    // select-then-edit gesture above. Web uses onContextMenu (right-click)
    // via a DOM prop the RN-Web Pressable forwards but doesn't type.
    const onLongPress = onContextMenu
        ? (e: GestureResponderEvent) => {
              const { pageX, pageY } = e.nativeEvent
              onContextMenu(row, col, pageX, pageY)
          }
        : undefined

    const webContextMenuProp =
        Platform.OS === 'web' && onContextMenu
            ? {
                  onContextMenu: (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
                      e.preventDefault()
                      onContextMenu(row, col, e.clientX, e.clientY)
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

    const showRemoteDraft = remoteDraft != null
    const textColor = showRemoteDraft ? remoteEditor?.user.color : undefined
    const isBold = cellValue?.style?.font?.bold === true
    const isItalic = cellValue?.style?.font?.italic === true

    const textStyle = showRemoteDraft
        ? {
              color: textColor,
              fontStyle: 'italic' as const,
              fontWeight: isBold ? ('bold' as const) : undefined,
          }
        : {
              fontWeight: isBold ? ('bold' as const) : undefined,
              fontStyle: isItalic ? ('italic' as const) : undefined,
          }

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityLabel={`Cell ${columnLabel(col)}${row}`}
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height: CELL_HEIGHT,
            }}
            className="border-r border-b border-border bg-background justify-center px-1"
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...((webContextMenuProp ?? {}) as any)}
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...((webMouseDownProp ?? {}) as any)}
            {...panHandlers}
        >
            <Text className="text-xs" numberOfLines={1} style={textStyle}>
                {showRemoteDraft ? remoteDraft : display}
            </Text>
        </Pressable>
    )
})

// locateCellAtGridCoord maps an (x, y) inside the grid body to the
// 1-based (row, col) of the cell at that point. Used by the cell
// PanResponder to translate pointer-move locations into the cell the
// user has dragged onto. Returns null when the coordinate falls in a
// hidden (zero-width) column or outside the grid.
function locateCellAtGridCoord(x: number, y: number, colOffsets: Float64Array): { row: number; col: number } | null {
    if (y < 0) return null
    const row = Math.floor(y / CELL_HEIGHT) + 1
    const col = firstColAtOffset(colOffsets, x)
    if (col < 1) return null
    const left = colOffsets[col - 1] ?? 0
    const right = colOffsets[col] ?? left
    if (right - left <= 0) return null
    return { row, col }
}

interface CellEditorProps {
    inputRef: React.RefObject<TextInput | null>
    left: number
    top: number
    width: number
    value: string
    selection: DraftSelection | undefined
    autoFocus: boolean
    onDraftChange: (draft: string) => void
    onSelectionChange: (start: number, end: number) => void
    onCommit: (value: string) => void
    onCancel: () => void
    onFocus: () => void
    onSpecialKey: (key: FormulaSpecialKey) => boolean
}

function CellEditor({
    inputRef,
    left,
    top,
    width,
    value,
    autoFocus,
    selection,
    onDraftChange,
    onSelectionChange,
    onCommit,
    onCancel,
    onFocus,
    onSpecialKey,
}: CellEditorProps) {
    // Fully controlled — Grid owns the draft state in editSession so
    // the formula bar and the in-cell editor stay synchronized.
    // Awareness publishing flows up through onDraftChange.
    return (
        <TextInput
            ref={inputRef}
            autoFocus={autoFocus}
            value={value}
            selection={selection}
            onChangeText={onDraftChange}
            onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
                const sel = e.nativeEvent.selection
                onSelectionChange(sel.start, sel.end)
            }}
            onSubmitEditing={() => onCommit(value)}
            onBlur={() => onCommit(value)}
            onFocus={onFocus}
            onKeyPress={(e) => {
                const key = (e.nativeEvent as { key?: string }).key
                if (key === 'Escape') {
                    if (onSpecialKey('Escape')) {
                        ;(e as unknown as { preventDefault?: () => void }).preventDefault?.()
                        return
                    }
                    onCancel()
                    return
                }
                if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Tab' || key === 'Enter') {
                    if (onSpecialKey(key)) {
                        ;(e as unknown as { preventDefault?: () => void }).preventDefault?.()
                    }
                }
            }}
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height: CELL_HEIGHT,
                paddingHorizontal: 4,
                fontSize: 12,
                borderWidth: 2,
                borderColor: '#22a06b',
            }}
            className="bg-background text-foreground"
        />
    )
}

interface RemoteSelectionOverlayProps {
    row: number
    col: number
    colOffsets: Float64Array
    color: string
    name: string
}

function RemoteSelectionOverlay({ row, col, colOffsets, color, name }: RemoteSelectionOverlayProps) {
    const left = colOffsets[col - 1] ?? 0
    const width = (colOffsets[col] ?? left) - left
    if (width <= 0) return null
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left,
                top: (row - 1) * CELL_HEIGHT,
                width,
                height: CELL_HEIGHT,
                borderWidth: 2,
                borderColor: color,
            }}
        >
            <View
                style={{
                    position: 'absolute',
                    bottom: -16,
                    left: 0,
                    paddingHorizontal: 4,
                    paddingVertical: 1,
                    backgroundColor: color,
                }}
            >
                <Text style={{ color: 'white', fontSize: 9 }} numberOfLines={1}>
                    {name}
                </Text>
            </View>
        </View>
    )
}

interface ResizePreviewLineProps {
    dragState: DragState | null
    colOffsets: Float64Array
    contentHeight: number
}

// Vertical green guide line drawn at the proposed new right-edge of
// the column being resized. Anchored to the absolute body so it
// scrolls with the cells but isn't clipped by per-cell windowing.
// Renders nothing when no drag is active — that's the default state
// the React tree can mount cheaply.
function ResizePreviewLine({ dragState, colOffsets, contentHeight }: ResizePreviewLineProps) {
    if (dragState == null) return null
    const left = (colOffsets[dragState.col - 1] ?? 0) + dragState.currentWidth
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: left - 1,
                top: 0,
                width: 2,
                height: contentHeight,
                backgroundColor: '#22a06b',
                opacity: 0.7,
            }}
        />
    )
}

interface HandleContextMenuProps {
    target: { col: number; cursor: { x: number; y: number } } | null
    onAutosize: (col: number) => void
    // onReset is wired to the same setYColWidth setter so writing the
    // default width deletes the entry — see lib/dimensions.ts. Pass
    // DEFAULT_COL_WIDTH as the value.
    onReset: (col: number, width: number) => void
    onClose: () => void
}

// Single small menu shared by every column-resize handle. Right-click
// (web) sets the target; selecting an item dispatches and closes.
// Native users don't currently get this menu — long-press on a 6px
// handle isn't a practical mobile gesture for autosize, and the
// drag-to-resize gesture already covers the common case.
function HandleContextMenu({ target, onAutosize, onReset, onClose }: HandleContextMenuProps) {
    const contentRef = useRef<View | null>(null)

    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (target == null) return
        if (typeof document === 'undefined') return
        const handler = (event: PointerEvent) => {
            const targetNode = event.target as Node | null
            const node = contentRef.current as unknown as Node | null
            if (targetNode && node?.contains(targetNode)) return
            onClose()
        }
        document.addEventListener('pointerdown', handler, true)
        return () => {
            document.removeEventListener('pointerdown', handler, true)
        }
    }, [target, onClose])

    const isOpen = target != null
    const triggerPos = target ? { x: target.cursor.x, y: target.cursor.y, width: 0, height: 0 } : null

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    const onAutosizeItem = useCallback(() => {
        if (target == null) return
        onAutosize(target.col)
        onClose()
    }, [target, onAutosize, onClose])

    const onResetItem = useCallback(() => {
        if (target == null) return
        onReset(target.col, DEFAULT_COL_WIDTH)
        onClose()
    }, [target, onReset, onClose])

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    <Menu.Item onPress={onAutosizeItem}>
                        <Menu.ItemTitle>Auto-fit column width</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onResetItem}>
                        <Menu.ItemTitle>Reset to default width</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

interface CellContextMenuProps {
    target: { cell: SelectedCell; cursor: { x: number; y: number } } | null
    doc: Y.Doc | null
    sheetId: string
    onClose: () => void
}

// Single Menu instance shared by every cell. Mounted in Grid so cells
// stay free of any per-cell Menu overhead. Positioned at the
// cursor/touch coordinates via Menu's triggerPosition prop (a 0×0
// "trigger rect" anchored at the click point produces a popover that
// drops down to the bottom-right of the cursor, with edge-flip handled
// by Menu.Content).
function CellContextMenu({ target, doc, sheetId, onClose }: CellContextMenuProps) {
    const contentRef = useRef<View | null>(null)

    // Web: dismiss on any pointerdown outside the menu content.
    // Mirrors the pattern in @tinycld/core/components/ContextMenu —
    // Gluestack's overlay scrim is unreliable for outside-click
    // dismissal (clicks can land on cells underneath).
    //
    // Native: a Pressable absolute-fill scrim inside Menu.Portal handles
    // taps outside; rendered conditionally below.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (target == null) return
        if (typeof document === 'undefined') return
        const handler = (event: PointerEvent) => {
            const targetNode = event.target as Node | null
            const node = contentRef.current as unknown as Node | null
            if (targetNode && node?.contains(targetNode)) return
            onClose()
        }
        document.addEventListener('pointerdown', handler, true)
        return () => {
            document.removeEventListener('pointerdown', handler, true)
        }
    }, [target, onClose])

    const isOpen = target != null
    const triggerPos = target ? { x: target.cursor.x, y: target.cursor.y, width: 0, height: 0 } : null

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    const onClear = useCallback(() => {
        if (target == null || doc == null) return
        setYCell(doc, sheetId, target.cell.row, target.cell.col, '')
    }, [doc, sheetId, target])

    const onToggleBold = useCallback(() => {
        if (target == null || doc == null) return
        const current = readCellStyle(doc, sheetId, target.cell.row, target.cell.col)
        const nextBold = current?.font?.bold !== true
        setYCellStyle(doc, sheetId, target.cell.row, target.cell.col, { font: { bold: nextBold } })
    }, [doc, sheetId, target])

    const onToggleItalic = useCallback(() => {
        if (target == null || doc == null) return
        const current = readCellStyle(doc, sheetId, target.cell.row, target.cell.col)
        const nextItalic = current?.font?.italic !== true
        setYCellStyle(doc, sheetId, target.cell.row, target.cell.col, { font: { italic: nextItalic } })
    }, [doc, sheetId, target])

    const currentStyle = target ? readCellStyle(doc, sheetId, target.cell.row, target.cell.col) : undefined
    const isBold = currentStyle?.font?.bold === true
    const isItalic = currentStyle?.font?.italic === true

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    <Menu.Item onPress={onClear}>
                        <Menu.ItemTitle>Clear contents</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onToggleBold}>
                        <Menu.ItemTitle>{isBold ? 'Remove bold' : 'Bold'}</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onToggleItalic}>
                        <Menu.ItemTitle>{isItalic ? 'Remove italic' : 'Italic'}</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
