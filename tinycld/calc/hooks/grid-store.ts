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
}

export interface GridActions {
    selectCell: (cell: SelectedCell) => void
    // Extend the current selection to include `cell` while keeping the
    // anchor (`selected`) fixed. Computes the bounding rectangle from
    // the anchor to `cell` and stores it in `selectionRange`. If there
    // is no anchor yet, this is equivalent to selectCell. Used by
    // shift-click and drag-select.
    extendSelectionTo: (cell: SelectedCell) => void
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
    openHandleMenu: (axis: 'col' | 'row', index: number, x: number, y: number) => void
    closeHandleMenu: () => void
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
    editSession: null,
    pendingSelection: null,
    activeSurface: 'cell',
    refDrag: null,
    suggestionIndex: 0,
    dismissedDraft: null,
    formulaBarRect: null,
    contextTarget: null,
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
                set({
                    selected: cell,
                    selectionRange: null,
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
                    editSession: null,
                    contextTarget: { cell: { row, col }, cursor: { x, y } },
                })
            },

            closeCellContextMenu: () => set({ contextTarget: null }),

            openHandleMenu: (axis, index, x, y) => {
                if (deps.readOnly) return
                set({ handleMenu: { axis, index, cursor: { x, y } } })
            },
            closeHandleMenu: () => set({ handleMenu: null }),
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
