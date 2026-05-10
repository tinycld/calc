// Per-Grid Zustand store. One instance per <Grid> mount, owned by a
// GridStoreProvider; never a module-level singleton — two Grids on the
// same screen each get their own state.
//
// Why Zustand here (not useReducer, not useState×N):
//   1. Cells subscribe to *primitive* selectors (booleans for
//      isSelected/isEditing, the draft string only for the editing
//      cell). Non-subscribers — the 99% of cells whose isSelected stays
//      false — short-circuit on reference equality and skip render.
//      That's the only way a single-keystroke edit re-renders 1 cell
//      instead of N visible cells.
//   2. Imperative reads via getState() eliminate the editSession ref
//      mirror that previously paired useState + useEffect (the exact
//      anti-pattern CLAUDE.md flags).
//   3. Awareness publishing becomes a single store.subscribe at the
//      Grid root rather than ~10 publishLocal calls scattered through
//      every action.
//
// All side effects (Y.Doc writes, input.focus(), awareness publish)
// flow through GridStoreDeps so the store stays pure and testable in
// isolation — yjs is never imported here.
import { createStore as createVanillaStore, type StoreApi } from 'zustand/vanilla'
import {
    applyFunctionInsertion,
    type DraftSelection,
    parseFunctionToken,
} from '../lib/formula/autocomplete'
import {
    applyCellRefInsertion,
    extendCellRefInsertion,
    formatRef,
    isRefAcceptable,
} from '../lib/formula/cell-ref-insertion'

export interface SelectedCell {
    row: number
    col: number
}

// CellRange is always normalized: startRow ≤ endRow, startCol ≤ endCol.
// The range describes a rectangle of cells that the user has selected
// in addition to the single `selected` anchor cell. When the range is
// null the selection is just the anchor (a single cell). The anchor is
// always *inside* the range, so iterators can ignore it and just walk
// the range.
export interface CellRange {
    startRow: number
    startCol: number
    endRow: number
    endCol: number
}

export interface EditSession {
    row: number
    col: number
    draft: string
}

// Which input most recently held focus. Drives suggestion-popover
// anchoring (formula bar coords vs. editing-cell coords).
export type ActiveSurface = 'bar' | 'cell'

// SelectionScope discriminates how the active selection should be
// interpreted by mutation paths. 'cells' is the default body selection
// (a rectangle of cells). 'row' / 'column' / 'sheet' indicate the user
// clicked a row/column header or the corner cell — toolbar setters
// route writes to per-row/per-col/per-sheet style metadata instead of
// iterating cells. selectionRange still describes the visible-tint
// rectangle, but scope is the source of truth for routing.
export type SelectionScope = 'cells' | 'row' | 'column' | 'sheet'

// A ref drag in progress while a formula is being edited. anchor is
// the first cell pressed; end tracks the cell currently under the
// pointer/finger. lastSlice is the substring index range of the most
// recent insertion in the draft, so the next pointer-move replaces it
// instead of appending another address.
export interface RefDrag {
    anchor: { row: number; col: number }
    end: { row: number; col: number }
    lastSlice: { start: number; end: number }
}

export interface FormulaBarRect {
    left: number
    top: number
    width: number
    height: number
}

export interface ContextTarget {
    cell: SelectedCell
    cursor: { x: number; y: number }
}

// Anchor for the threaded-comment popover. cursor mirrors ContextTarget
// — popover opens at the user's click point (right-click "Comment"
// item) or the cell's screen rect (keyboard shortcut path).
export interface CommentTarget {
    cell: SelectedCell
    cursor: { x: number; y: number }
}

export interface HandleMenuTarget {
    // Discriminator: column-handle menu (right-click on column resize
    // grip) vs. row-handle menu (right-click on row resize grip). Both
    // use the same Menu component to keep the visual surface minimal;
    // the action handlers branch on `axis`.
    axis: 'col' | 'row'
    // Index of the column or row whose handle was clicked.
    index: number
    cursor: { x: number; y: number }
}

// GridState carries everything the Grid's UI subtree subscribes to.
// Y.Doc data (cell raw/formula/style) is intentionally NOT here — that
// stays behind useYCell so per-cell observers fire only when the
// specific cell's CRDT entry changes. The store is for selection,
// editing, ref-drag, suggestion-popover, and menu state.
export interface GridState {
    // The anchor cell — drives the formula bar, header highlights, and
    // the keyboard-nav origin. Always inside `selectionRange` when that
    // is non-null. Existing call sites that use `selected` continue to
    // see the active cell.
    selected: SelectedCell | null
    // Optional rectangle for multi-cell selection. `null` means the
    // selection is just the single `selected` cell. When non-null the
    // range is normalized (start ≤ end on both axes) and contains
    // `selected`.
    selectionRange: CellRange | null
    // Discriminator for how the selection should be interpreted by
    // mutation paths. 'cells' = body selection (per-cell writes).
    // 'row'/'column'/'sheet' = lazy-style scope (writes to per-axis
    // sheet metadata). Body interactions (selectCell, extendSelectionTo)
    // reset to 'cells'. Header-click actions (selectRow/Column/Sheet)
    // set the scope explicitly.
    selectionScope: SelectionScope
    editSession: EditSession | null
    // Programmatic-insert override for the input's selection prop.
    // Cleared on the next onSelectionChange so subsequent typing
    // doesn't snap the caret back. Only the editing cell reads this.
    pendingSelection: DraftSelection | null
    activeSurface: ActiveSurface
    refDrag: RefDrag | null
    suggestionIndex: number
    // The draft at which the user last pressed Esc to dismiss the
    // popover. Stays sticky until the next keystroke produces a
    // different draft, matching standard autocomplete UX.
    dismissedDraft: string | null
    formulaBarRect: FormulaBarRect | null
    contextTarget: ContextTarget | null
    commentTarget: CommentTarget | null
    handleMenu: HandleMenuTarget | null
}

// Live cursor position inside the editing input. Stored as a
// ref-style mutable container, never as state — a fresh selection on
// every keystroke would re-render every subscriber that depended on
// it. Callbacks read .current to get the up-to-date value.
//
// `lastRefSlice` is the substring range of the most-recent ref-tap
// insertion, so a follow-up tap on a different cell extends rather
// than appending. Reset on commit/cancel/keystroke that isn't a ref
// op.
export interface GridRefs {
    editCursor: { current: DraftSelection }
    lastRefSlice: { current: { start: number; end: number } | null }
}

// GridStoreDeps are the side-effect callbacks the store invokes when
// an action needs to touch something outside its own state. Provided
// by the Grid component at create time. Keeping them injected (rather
// than imported inside the store) means the store has no yjs/awareness
// dependency and can be unit-tested with stubs.
// StructuralOp describes a row/column insert or delete. The store
// dispatches these to deps.applyStructuralMutation so the yjs writes
// stay outside the store (mirrors writeCell). Position is implicit:
// for insertRows, atRow is already the *insert position* (1-based row
// index where the new rows go) — the store derives this from the
// selection + 'above'/'below' so the dep just executes.
// displayedRowCount / displayedColCount on insert ops carry the
// rendered grid size (Grid.tsx clamps display dims up to MIN_ROWS /
// MIN_COLS, so a fresh sheet shows 50×26 with stored counts of 0).
// The structural mutation uses them to ensure the post-insert
// row/colCount covers everything the user could see *plus* the
// inserted rows/columns — otherwise inserting at a position past the
// stored count leaves part of the visible grid outside the sheet.
export type StructuralOp =
    | {
          kind: 'insertRows'
          atRow: number
          count: number
          position: 'above' | 'below'
          displayedRowCount: number
      }
    | {
          kind: 'insertColumns'
          atCol: number
          count: number
          position: 'left' | 'right'
          displayedColCount: number
      }
    | { kind: 'deleteRows'; fromRow: number; count: number }
    | { kind: 'deleteColumns'; fromCol: number; count: number }

export interface GridStoreDeps {
    readOnly: boolean
    // Persist a cell's user-typed string to the Y.Doc. Empty string
    // clears the cell. The store calls this from commitEdit and from
    // the click-away path inside selectCell when an edit on a
    // different cell is in flight.
    writeCell: (row: number, col: number, value: string) => void
    // Focus the input the user most recently interacted with. Used by
    // ref-drag end so the pan gesture doesn't leave the input blurred
    // (which would commit the half-typed formula).
    focusActiveInput: () => void
    // Apply a structural row/column insert or delete to the Y.Doc.
    // Provided by Grid (which holds the doc + sheetId). The store
    // dispatches this from insert*/delete* actions and updates its
    // selection state in the same set() so the highlight follows the
    // shifted cells in one render.
    applyStructuralMutation: (op: StructuralOp) => void
}

export interface GridActions {
    selectCell: (cell: SelectedCell) => void
    // Extend the current selection to include `cell` while keeping the
    // anchor (`selected`) fixed. Computes the bounding rectangle from
    // the anchor to `cell` and stores it in `selectionRange`. If there
    // is no anchor yet, this is equivalent to selectCell. Used by
    // shift-click and drag-select.
    extendSelectionTo: (cell: SelectedCell) => void
    // selectRow sets scope='row' with anchor=(row,1) and a range
    // covering (row,1)..(row,colCount). Triggered by clicking a row
    // header. Toolbar setters dispatch to per-row metadata writes
    // instead of iterating cells. The caller passes colCount because
    // the store has no Y.Doc dependency — Grid reads it from
    // useYSheets.
    selectRow: (row: number, colCount: number) => void
    editCell: (cell: SelectedCell, initialDraft?: string) => void
    setEditDraft: (row: number, col: number, draft: string) => void
    setEditSelection: (row: number, col: number, start: number, end: number) => void
    commitEdit: (row: number, col: number, value: string) => void
    cancelEdit: () => void
    clearCellAt: (row: number, col: number) => void
    setActiveSurface: (surface: ActiveSurface) => void
    setFormulaBarRect: (rect: FormulaBarRect) => void
    // Ref-insertion. Returns true when the gesture was handled (cursor
    // was in a ref-acceptable position and the address spliced into
    // the draft). Cells use the boolean to skip their normal
    // select/edit fallback.
    cellRefTap: (row: number, col: number) => boolean
    cellRefDragStart: (row: number, col: number) => boolean
    cellRefDragMove: (row: number, col: number) => void
    cellRefDragEnd: () => void
    // Used by the ref-drag tracking effect to write the live range
    // into the draft. Internal-ish; exposed because the effect runs in
    // Grid.
    extendRefDragDraft: (nextDraft: string, nextSlice: { start: number; end: number }) => void
    // Suggestion popover.
    moveSuggestion: (delta: number, total: number) => void
    setSuggestionIndex: (index: number) => void
    dismissSuggestions: () => void
    insertFunction: (name: string) => void
    // Context menus.
    openCellContextMenu: (row: number, col: number, x: number, y: number) => void
    closeCellContextMenu: () => void
    openCommentPopover: (row: number, col: number, x: number, y: number) => void
    closeCommentPopover: () => void
    openHandleMenu: (axis: 'col' | 'row', index: number, x: number, y: number) => void
    closeHandleMenu: () => void
    // Structural mutations driven by the cell context menu. Derive
    // from/count from the active selection (collapsed to 1 row/col when
    // there is no range). Selection state is updated in the same
    // set() so the highlight follows the shifted cells. Insert actions
    // take the *displayed* row/colCount (max of stored count and the
    // grid's MIN_ROWS/MIN_COLS floor) so the post-insert sheet expands
    // to cover everything the user can see — see StructuralOp comment.
    insertRowsAtSelection: (position: 'above' | 'below', displayedRowCount: number) => void
    insertColumnsAtSelection: (position: 'left' | 'right', displayedColCount: number) => void
    // Delete actions need the *current* row/colCount so the post-delete
    // anchor can be clamped into the new bounds. Caller passes it from
    // useYSheets — mirrors selectRow/Column.
    deleteSelectedRows: (currentRowCount: number) => void
    deleteSelectedColumns: (currentColCount: number) => void
    // Structural mutations driven by the row/column header context
    // menu. The index is the row or column whose handle was clicked
    // (resolved via state.handleMenu.index in the caller).
    insertRowAtHandle: (
        index: number,
        position: 'above' | 'below',
        displayedRowCount: number
    ) => void
    insertColumnAtHandle: (
        index: number,
        position: 'left' | 'right',
        displayedColCount: number
    ) => void
    deleteRowAtHandle: (index: number, currentRowCount: number) => void
    deleteColumnAtHandle: (index: number, currentColCount: number) => void
}

export interface GridStore extends GridState, GridActions {}

export type GridStoreApi = StoreApi<GridStore> & { refs: GridRefs }

// Local helper — duplicated rather than importing from
// lib/selection-range.ts to avoid a circular import (the lib imports
// CellRange from this file).
function rangeContainsCell(range: CellRange, row: number, col: number): boolean {
    return (
        row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol
    )
}

const initialState: GridState = {
    selected: null,
    selectionRange: null,
    selectionScope: 'cells',
    editSession: null,
    pendingSelection: null,
    activeSurface: 'cell',
    refDrag: null,
    suggestionIndex: 0,
    dismissedDraft: null,
    formulaBarRect: null,
    contextTarget: null,
    commentTarget: null,
    handleMenu: null,
}

export function createGridStore(deps: GridStoreDeps): GridStoreApi {
    const refs: GridRefs = {
        editCursor: { current: { start: 0, end: 0 } },
        lastRefSlice: { current: null },
    }

    const store = createVanillaStore<GridStore>()((set, get) => {
        // commitInflight: when something else needs to take focus
        // (selectCell on a different cell, openCellContextMenu),
        // commit any pending edit on the prior cell. Mirrors the
        // click-away semantics of pressing Enter/blur.
        const commitInflight = (target: SelectedCell | null) => {
            const current = get().editSession
            if (current == null) return
            if (target != null && current.row === target.row && current.col === target.col) return
            if (deps.readOnly) return
            deps.writeCell(current.row, current.col, current.draft)
        }

        return {
            ...initialState,

            selectCell: cell => {
                commitInflight(cell)
                refs.lastRefSlice.current = null
                // If a comment popover is open and the user picks a
                // different cell, dismiss it — the popover is anchored
                // to a single cell and the new selection means the user
                // moved on. Same cell click is still a no-op for the
                // popover.
                const prevCommentTarget = get().commentTarget
                const closeComment =
                    prevCommentTarget != null &&
                    (prevCommentTarget.cell.row !== cell.row ||
                        prevCommentTarget.cell.col !== cell.col)
                set({
                    selected: cell,
                    selectionRange: null,
                    selectionScope: 'cells',
                    editSession: null,
                    pendingSelection: null,
                    commentTarget: closeComment ? null : prevCommentTarget,
                })
            },

            selectRow: (row, colCount) => {
                refs.lastRefSlice.current = null
                const anchor = { row, col: 1 }
                commitInflight(anchor)
                set({
                    selected: anchor,
                    selectionRange: {
                        startRow: row,
                        endRow: row,
                        startCol: 1,
                        endCol: Math.max(1, colCount),
                    },
                    selectionScope: 'row',
                    editSession: null,
                    pendingSelection: null,
                })
            },

            extendSelectionTo: cell => {
                // commitInflight FIRST: extending the selection ends
                // any edit session on a different cell, and that draft
                // must be persisted (mirror of selectCell — the gate
                // would silently drop the user's typing otherwise).
                // Calling unconditionally is safe: commitInflight
                // no-ops when there is no edit session, when
                // readOnly, or when the edit target equals `cell`.
                commitInflight(cell)
                refs.lastRefSlice.current = null
                const anchor = get().selected
                if (anchor == null) {
                    // No anchor yet — fall through to a plain
                    // single-cell select so the gesture isn't lost.
                    set({
                        selected: cell,
                        selectionRange: null,
                        selectionScope: 'cells',
                        editSession: null,
                        pendingSelection: null,
                    })
                    return
                }
                const range: CellRange = {
                    startRow: Math.min(anchor.row, cell.row),
                    endRow: Math.max(anchor.row, cell.row),
                    startCol: Math.min(anchor.col, cell.col),
                    endCol: Math.max(anchor.col, cell.col),
                }
                // Single-cell range collapses to null so the rest of the
                // store stays in the canonical "no range" form.
                const single = range.startRow === range.endRow && range.startCol === range.endCol
                set({
                    selectionRange: single ? null : range,
                    selectionScope: 'cells',
                    editSession: null,
                    pendingSelection: null,
                })
            },

            editCell: (cell, initialDraft = '') => {
                if (deps.readOnly) return
                const cursor = initialDraft.length
                refs.editCursor.current = { start: cursor, end: cursor }
                refs.lastRefSlice.current = null
                set({
                    selected: cell,
                    selectionRange: null,
                    selectionScope: 'cells',
                    editSession: { row: cell.row, col: cell.col, draft: initialDraft },
                    pendingSelection: { start: cursor, end: cursor },
                    activeSurface: 'cell',
                })
            },

            setEditDraft: (row, col, draft) => {
                // Manual typing supersedes any pending ref-tap
                // insertion; the slice memo would otherwise mis-replace
                // user text.
                refs.lastRefSlice.current = null
                const prev = get().editSession
                // When this is the first draft change for a fresh edit
                // session (no prior session, or session targeted a
                // different cell), snap the cursor to the end of the
                // draft. Without this the cursor ref carries the
                // position from a previous edit and downstream
                // consumers (autocomplete dropdown, cell-ref insertion)
                // read a stale value before the browser's
                // selectionchange event refreshes it.
                const isFreshSession = prev == null || prev.row !== row || prev.col !== col
                if (isFreshSession || refs.editCursor.current.end > draft.length) {
                    refs.editCursor.current = { start: draft.length, end: draft.length }
                }
                if (prev != null && prev.row === row && prev.col === col && prev.draft === draft)
                    return
                set({ editSession: { row, col, draft } })
            },

            setEditSelection: (row, col, start, end) => {
                // Update the cursor ref so callbacks read the live
                // value, but don't store in state — selection-only
                // changes shouldn't re-render every cell. Clear any
                // pending controlled-selection override now that the
                // input has reported its actual cursor.
                const cur = get().editSession
                if (cur == null || cur.row !== row || cur.col !== col) return
                refs.editCursor.current = { start, end }
                if (get().pendingSelection != null) set({ pendingSelection: null })
            },

            commitEdit: (row, col, value) => {
                if (!deps.readOnly) deps.writeCell(row, col, value)
                refs.lastRefSlice.current = null
                set({
                    selected: { row, col },
                    selectionRange: null,
                    selectionScope: 'cells',
                    editSession: null,
                    pendingSelection: null,
                })
            },

            cancelEdit: () => {
                refs.lastRefSlice.current = null
                set({ editSession: null, pendingSelection: null })
            },

            clearCellAt: (row, col) => {
                if (deps.readOnly) return
                deps.writeCell(row, col, '')
            },

            setActiveSurface: surface => set({ activeSurface: surface }),
            setFormulaBarRect: rect => set({ formulaBarRect: rect }),

            cellRefTap: (row, col) => {
                const session = get().editSession
                if (session == null) return false
                if (!isRefAcceptable(session.draft, refs.editCursor.current.end)) return false
                const ref = formatRef(row, col)
                const prevSlice = refs.lastRefSlice.current
                const result =
                    prevSlice != null
                        ? extendCellRefInsertion(session.draft, prevSlice, ref)
                        : applyCellRefInsertion(session.draft, refs.editCursor.current.end, ref)
                refs.lastRefSlice.current = result.insertedSlice
                refs.editCursor.current = result.selection
                set({
                    editSession: { row: session.row, col: session.col, draft: result.draft },
                    pendingSelection: result.selection,
                })
                deps.focusActiveInput()
                return true
            },

            cellRefDragStart: (row, col) => {
                const session = get().editSession
                if (session == null) return false
                if (!isRefAcceptable(session.draft, refs.editCursor.current.end)) return false
                const ref = formatRef(row, col)
                const prevSlice = refs.lastRefSlice.current
                const result =
                    prevSlice != null
                        ? extendCellRefInsertion(session.draft, prevSlice, ref)
                        : applyCellRefInsertion(session.draft, refs.editCursor.current.end, ref)
                refs.lastRefSlice.current = result.insertedSlice
                refs.editCursor.current = result.selection
                set({
                    editSession: { row: session.row, col: session.col, draft: result.draft },
                    pendingSelection: result.selection,
                    refDrag: {
                        anchor: { row, col },
                        end: { row, col },
                        lastSlice: result.insertedSlice,
                    },
                })
                return true
            },

            cellRefDragMove: (row, col) => {
                const drag = get().refDrag
                if (drag == null) return
                if (drag.end.row === row && drag.end.col === col) return
                set({ refDrag: { ...drag, end: { row, col } } })
            },

            cellRefDragEnd: () => {
                set({ refDrag: null })
                deps.focusActiveInput()
            },

            extendRefDragDraft: (nextDraft, nextSlice) => {
                const session = get().editSession
                const drag = get().refDrag
                if (session == null || drag == null) return
                refs.lastRefSlice.current = nextSlice
                refs.editCursor.current = { start: nextDraft.length, end: nextDraft.length }
                set({
                    editSession: { row: session.row, col: session.col, draft: nextDraft },
                    pendingSelection: { start: nextDraft.length, end: nextDraft.length },
                    refDrag: { ...drag, lastSlice: nextSlice },
                })
            },

            moveSuggestion: (delta, total) => {
                if (total <= 0) return
                const cur = get().suggestionIndex
                const next = (((cur + delta) % total) + total) % total
                set({ suggestionIndex: next })
            },

            setSuggestionIndex: index => set({ suggestionIndex: index }),

            dismissSuggestions: () => {
                const session = get().editSession
                if (session == null) return
                set({ dismissedDraft: session.draft })
            },

            insertFunction: name => {
                const session = get().editSession
                if (session == null) return
                const t = parseFunctionToken(session.draft, refs.editCursor.current.end)
                if (t == null) return
                const result = applyFunctionInsertion(session.draft, t, name)
                refs.editCursor.current = result.selection
                refs.lastRefSlice.current = null
                set({
                    editSession: { row: session.row, col: session.col, draft: result.draft },
                    pendingSelection: result.selection,
                })
            },

            openCellContextMenu: (row, col, x, y) => {
                // Right-clicking inside an existing multi-cell range
                // keeps the range alive so range-targeted menu items
                // (clear contents, etc.) still apply to the whole
                // selection. Right-clicking outside the range collapses
                // to a single-cell selection on the clicked cell.
                //
                // Read-then-commit ordering matters: we capture the
                // pre-commit selectionRange BEFORE commitInflight,
                // because today commitInflight only writes the cell
                // and doesn't touch selectionRange — but if that ever
                // changes (e.g. an auto-deselect on commit), this
                // branch would silently lose the range. The captured
                // `state` snapshot keeps the contract explicit.
                const state = get()
                const insideRange =
                    state.selectionRange != null &&
                    rangeContainsCell(state.selectionRange, row, col)
                commitInflight({ row, col })
                set({
                    selected: insideRange ? state.selected : { row, col },
                    selectionRange: insideRange ? state.selectionRange : null,
                    selectionScope: insideRange ? state.selectionScope : 'cells',
                    editSession: null,
                    contextTarget: { cell: { row, col }, cursor: { x, y } },
                })
            },

            closeCellContextMenu: () => set({ contextTarget: null }),

            openCommentPopover: (row, col, x, y) => {
                commitInflight({ row, col })
                set({
                    selected: { row, col },
                    selectionRange: null,
                    selectionScope: 'cells',
                    editSession: null,
                    contextTarget: null,
                    commentTarget: { cell: { row, col }, cursor: { x, y } },
                })
            },

            closeCommentPopover: () => set({ commentTarget: null }),

            openHandleMenu: (axis, index, x, y) => {
                if (deps.readOnly) return
                set({ handleMenu: { axis, index, cursor: { x, y } } })
            },
            closeHandleMenu: () => set({ handleMenu: null }),

            // Structural mutations. After an insert above row N,
            // anything previously at row >= N now lives at row +count;
            // shift the anchor and range to follow. After a delete
            // starting at row F covering C rows: rows in [F, F+C) are
            // gone, rows >= F+C shift down by C, and the anchor clamps
            // into the new bounds.
            insertRowsAtSelection: (position, displayedRowCount) => {
                if (deps.readOnly) return
                const state = get()
                if (state.selected == null) return
                const range = state.selectionRange
                const startRow = range?.startRow ?? state.selected.row
                const endRow = range?.endRow ?? state.selected.row
                const atRow = position === 'above' ? startRow : endRow
                const count = endRow - startRow + 1
                const insertAt = position === 'above' ? atRow : atRow + 1
                deps.applyStructuralMutation({
                    kind: 'insertRows',
                    atRow,
                    count,
                    position,
                    displayedRowCount,
                })

                const shifted = (r: number) => (r >= insertAt ? r + count : r)
                set({
                    selected: { row: shifted(state.selected.row), col: state.selected.col },
                    selectionRange:
                        range != null
                            ? {
                                  startRow: shifted(range.startRow),
                                  endRow: shifted(range.endRow),
                                  startCol: range.startCol,
                                  endCol: range.endCol,
                              }
                            : null,
                    contextTarget: null,
                })
            },

            insertColumnsAtSelection: (position, displayedColCount) => {
                if (deps.readOnly) return
                const state = get()
                if (state.selected == null) return
                const range = state.selectionRange
                const startCol = range?.startCol ?? state.selected.col
                const endCol = range?.endCol ?? state.selected.col
                const atCol = position === 'left' ? startCol : endCol
                const count = endCol - startCol + 1
                const insertAt = position === 'left' ? atCol : atCol + 1
                deps.applyStructuralMutation({
                    kind: 'insertColumns',
                    atCol,
                    count,
                    position,
                    displayedColCount,
                })

                const shifted = (c: number) => (c >= insertAt ? c + count : c)
                set({
                    selected: { row: state.selected.row, col: shifted(state.selected.col) },
                    selectionRange:
                        range != null
                            ? {
                                  startRow: range.startRow,
                                  endRow: range.endRow,
                                  startCol: shifted(range.startCol),
                                  endCol: shifted(range.endCol),
                              }
                            : null,
                    contextTarget: null,
                })
            },

            deleteSelectedRows: currentRowCount => {
                if (deps.readOnly) return
                const state = get()
                if (state.selected == null) return
                const range = state.selectionRange
                const fromRow = range?.startRow ?? state.selected.row
                const requestedCount = range != null ? range.endRow - range.startRow + 1 : 1
                // Mirror the floor-at-1 logic in deleteRows so the
                // selection update uses the same effective `count` the
                // mutation will apply.
                const maxDeletable = Math.max(0, currentRowCount - 1)
                const count = Math.min(requestedCount, maxDeletable, currentRowCount - fromRow + 1)
                if (count <= 0) {
                    set({ contextTarget: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteRows', fromRow, count })

                const newRowCount = Math.max(1, currentRowCount - count)
                const clampRow = (r: number) => {
                    if (r < fromRow) return r
                    if (r >= fromRow + count) return r - count
                    // Anchor was inside the deleted range: snap to the
                    // first surviving row at the deletion site, clamped
                    // into the new bounds.
                    return Math.min(fromRow, newRowCount)
                }
                set({
                    selected: { row: clampRow(state.selected.row), col: state.selected.col },
                    selectionRange: null,
                    selectionScope: 'cells',
                    contextTarget: null,
                })
            },

            deleteSelectedColumns: currentColCount => {
                if (deps.readOnly) return
                const state = get()
                if (state.selected == null) return
                const range = state.selectionRange
                const fromCol = range?.startCol ?? state.selected.col
                const requestedCount = range != null ? range.endCol - range.startCol + 1 : 1
                const maxDeletable = Math.max(0, currentColCount - 1)
                const count = Math.min(requestedCount, maxDeletable, currentColCount - fromCol + 1)
                if (count <= 0) {
                    set({ contextTarget: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteColumns', fromCol, count })

                const newColCount = Math.max(1, currentColCount - count)
                const clampCol = (c: number) => {
                    if (c < fromCol) return c
                    if (c >= fromCol + count) return c - count
                    return Math.min(fromCol, newColCount)
                }
                set({
                    selected: { row: state.selected.row, col: clampCol(state.selected.col) },
                    selectionRange: null,
                    selectionScope: 'cells',
                    contextTarget: null,
                })
            },

            insertRowAtHandle: (index, position, displayedRowCount) => {
                if (deps.readOnly) return
                deps.applyStructuralMutation({
                    kind: 'insertRows',
                    atRow: index,
                    count: 1,
                    position,
                    displayedRowCount,
                })
                const insertAt = position === 'above' ? index : index + 1
                const state = get()
                const shifted = (r: number) => (r >= insertAt ? r + 1 : r)
                set({
                    selected:
                        state.selected != null
                            ? { row: shifted(state.selected.row), col: state.selected.col }
                            : state.selected,
                    selectionRange:
                        state.selectionRange != null
                            ? {
                                  startRow: shifted(state.selectionRange.startRow),
                                  endRow: shifted(state.selectionRange.endRow),
                                  startCol: state.selectionRange.startCol,
                                  endCol: state.selectionRange.endCol,
                              }
                            : null,
                    handleMenu: null,
                })
            },

            insertColumnAtHandle: (index, position, displayedColCount) => {
                if (deps.readOnly) return
                deps.applyStructuralMutation({
                    kind: 'insertColumns',
                    atCol: index,
                    count: 1,
                    position,
                    displayedColCount,
                })
                const insertAt = position === 'left' ? index : index + 1
                const state = get()
                const shifted = (c: number) => (c >= insertAt ? c + 1 : c)
                set({
                    selected:
                        state.selected != null
                            ? { row: state.selected.row, col: shifted(state.selected.col) }
                            : state.selected,
                    selectionRange:
                        state.selectionRange != null
                            ? {
                                  startRow: state.selectionRange.startRow,
                                  endRow: state.selectionRange.endRow,
                                  startCol: shifted(state.selectionRange.startCol),
                                  endCol: shifted(state.selectionRange.endCol),
                              }
                            : null,
                    handleMenu: null,
                })
            },

            deleteRowAtHandle: (index, currentRowCount) => {
                if (deps.readOnly) return
                if (currentRowCount <= 1) {
                    set({ handleMenu: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteRows', fromRow: index, count: 1 })
                const newRowCount = currentRowCount - 1
                const clampRow = (r: number) => {
                    if (r < index) return r
                    if (r > index) return r - 1
                    return Math.min(index, newRowCount)
                }
                const state = get()
                set({
                    selected:
                        state.selected != null
                            ? { row: clampRow(state.selected.row), col: state.selected.col }
                            : state.selected,
                    selectionRange: null,
                    selectionScope: 'cells',
                    handleMenu: null,
                })
            },

            deleteColumnAtHandle: (index, currentColCount) => {
                if (deps.readOnly) return
                if (currentColCount <= 1) {
                    set({ handleMenu: null })
                    return
                }
                deps.applyStructuralMutation({ kind: 'deleteColumns', fromCol: index, count: 1 })
                const newColCount = currentColCount - 1
                const clampCol = (c: number) => {
                    if (c < index) return c
                    if (c > index) return c - 1
                    return Math.min(index, newColCount)
                }
                const state = get()
                set({
                    selected:
                        state.selected != null
                            ? { row: state.selected.row, col: clampCol(state.selected.col) }
                            : state.selected,
                    selectionRange: null,
                    selectionScope: 'cells',
                    handleMenu: null,
                })
            },
        }
    })

    // Reset suggestionIndex and dismissedDraft when the edit session
    // ends — these are tied to a live edit and shouldn't carry over.
    store.subscribe((state, prev) => {
        if (state.editSession == null && prev.editSession != null) {
            const patch: Partial<GridState> = {}
            if (state.suggestionIndex !== 0) patch.suggestionIndex = 0
            if (state.dismissedDraft != null) patch.dismissedDraft = null
            if (Object.keys(patch).length > 0) store.setState(patch)
        } else if (
            state.editSession != null &&
            prev.editSession != null &&
            state.editSession.draft !== prev.editSession.draft &&
            state.dismissedDraft != null &&
            state.dismissedDraft !== state.editSession.draft
        ) {
            // User typed past the dismissed point — re-arm the popover.
            store.setState({ dismissedDraft: null })
        }
    })

    return Object.assign(store, { refs })
}
