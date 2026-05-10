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
import { effectiveRange } from '../lib/selection-range'

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

// Fill-handle drag in progress. sourceRange is the user's pre-drag
// selection (captured at fillDragStart and never mutated). destRange
// grows as the pointer moves and always contains sourceRange — the
// rectangle is anchored at sourceRange's top-left and extends down or
// right. direction is the dominant axis the drag is currently locked
// to; until directionLocked flips true (on the first move strictly
// past the source's bottom or right edge), the placeholder direction
// has no effect because destRange == sourceRange.
export interface FillDrag {
    sourceRange: CellRange
    destRange: CellRange
    direction: 'down' | 'right'
    directionLocked: boolean
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
    // Clipboard state, populated by the orchestrating useClipboard
    // hook on copy/cut. `clipboardMarker` is the in-memory fidelity-
    // store key the OS clipboard's HTML <meta> tag carries; the
    // source range is preserved for the marching-ants overlay so the
    // user can see what they copied. `cutPending` distinguishes a cut
    // (clear-source-on-paste) from a copy (leave source intact).
    // All three clear together when a paste consumes the cut, when
    // the user presses Esc, or after a 30-second timeout.
    clipboardMarker: string | null
    copySourceRange: CellRange | null
    cutPending: boolean
    // Active fill-handle drag, or null when the user isn't dragging
    // the selection-handle dot. The preview overlay subscribes to this
    // to paint the green extension rectangle, and fillDragEnd reads it
    // to dispatch the commit through deps.applyFill.
    fillDrag: FillDrag | null
    // Sort/Filter UI state. The persistent filter view definition
    // lives on Y.Doc sheet metadata (lib/filter.ts FILTER_VIEW_KEY);
    // these flags track only the transient dialog/dropdown visibility
    // so a reload doesn't snap them open.
    sortDialogOpen: boolean
    filterDropdownCol: number | null
    // Status banner shown after a sort dissolved merges. Cleared by
    // the next user action via dismissSortStatus.
    sortStatus: { mergesBroken: number } | null
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
    // Commit a fill-handle drag to the Y.Doc. The store calls this
    // from fillDragEnd with the captured source range, the final dest
    // rectangle, and the dominant axis. Series detection + projection
    // happens inside the dep so the store stays free of yjs and the
    // detection lib.
    applyFill: (opts: {
        sourceRange: CellRange
        destRange: CellRange
        direction: 'down' | 'right'
    }) => void
    // Resolve a (row, col) to its merge anchor when the cell sits
    // inside a merged rectangle, otherwise echo back the input. Lets
    // selection actions snap a click on a covered cell to the anchor
    // without giving the store a Y.Doc dependency.
    resolveMergeAnchor: (row: number, col: number) => { row: number; col: number }
    // Grow `range` so every merge it touches is fully contained.
    // Returns the input range when no merges intersect.
    expandRangeOverMerges: (range: CellRange) => CellRange
    // List the merges that intersect the given range. Used by
    // unmergeSelection to iterate merges in the range.
    findMergesInRange: (range: CellRange) => MergeAnchor[]
    // Merge / unmerge primitives that touch the Y.Doc. The store
    // dispatches these from mergeSelection / unmergeSelection so it
    // can stay yjs-free.
    mergeRange: (range: CellRange) => void
    unmergeAt: (anchorRow: number, anchorCol: number) => void
    // Persist a freeze count to the sheet's metadata. Count <= 0
    // unfreezes the axis. Wired in use-grid-store-instance to
    // setFrozenRows/setFrozenCols so the store stays free of yjs.
    setFrozenRows: (n: number) => void
    setFrozenCols: (n: number) => void
}

// MergeAnchor is the store-side view of one merged-cell rectangle.
// Keeps the store free of any direct merge.ts import; the dep
// implementation in use-grid-store-instance maps the lib's MergeRange
// to this shape (which happens to be structurally identical).
export interface MergeAnchor {
    anchorRow: number
    anchorCol: number
    rowSpan: number
    colSpan: number
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
    // Freeze panes. n=0 unfreezes the axis. Independent: setting one
    // axis leaves the other untouched. setFrozenRows(0) and
    // setFrozenCols(0) are equivalent to unfreeze() for that single
    // axis; unfreeze() clears both in one call.
    setFrozenRows: (n: number) => void
    setFrozenCols: (n: number) => void
    unfreeze: () => void
    // Clipboard lifecycle. setClipboardMarker is called by useClipboard
    // on copy (isCut=false) and cut (isCut=true); it schedules a 30s
    // timeout that auto-clears the marker so an abandoned cut doesn't
    // leak the marching-ants overlay forever. clearClipboardMarker is
    // called on Esc, after a paste consumes a cut, when a 30s timeout
    // fires, or when the source range is overwritten.
    setClipboardMarker: (markerId: string, sourceRange: CellRange, isCut: boolean) => void
    clearClipboardMarker: () => void
    // Fill-handle drag lifecycle. Start captures the current effective
    // range as the immutable source; move grows the dest rectangle and
    // locks the axis on the first move past the source's edge; end
    // dispatches deps.applyFill and snaps the post-fill selection to
    // the dest rectangle (Sheets behavior). Returns false from start
    // when there's nothing to fill from (no selection or readOnly), so
    // the overlay can fall back to selection-extend.
    fillDragStart: () => boolean
    fillDragMove: (target: { row: number; col: number }) => void
    fillDragEnd: () => void
    // Sort dialog open/close. Pure UI state — the actual sort runs via
    // a sort.ts call wired from the SortDialog's Apply button.
    openSortDialog: () => void
    closeSortDialog: () => void
    // Filter dropdown anchored on a specific column header. Null when
    // closed. Only one dropdown is open at a time.
    openFilterDropdown: (col: number) => void
    closeFilterDropdown: () => void
    // Status banner after a sort dissolved one or more merges.
    setSortStatus: (status: { mergesBroken: number } | null) => void
    // Merge the current selection into a single merged cell. If the
    // selection touches existing merges, the range first expands to
    // fully contain them so the resulting merge is well-defined.
    mergeSelection: () => void
    // Variant that splits the selection into one horizontal merge per
    // row (so a 3×3 selection becomes 3 horizontal merges of 3 cells
    // each). No-op when the selection is a single column.
    mergeSelectionHorizontal: () => void
    // Variant that splits the selection into one vertical merge per
    // column. No-op when the selection is a single row.
    mergeSelectionVertical: () => void
    // Unmerge every merge that touches the current selection.
    unmergeSelection: () => void
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

// Bounds-equality on a CellRange, used by fillDragMove to short-
// circuit redundant set() calls. Cheaper than JSON.stringify and
// avoids the object-identity false-negative we'd hit comparing
// instances by reference.
function rangesEqual(a: CellRange, b: CellRange): boolean {
    return (
        a.startRow === b.startRow &&
        a.endRow === b.endRow &&
        a.startCol === b.startCol &&
        a.endCol === b.endCol
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
    clipboardMarker: null,
    copySourceRange: null,
    cutPending: false,
    fillDrag: null,
    sortDialogOpen: false,
    filterDropdownCol: null,
    sortStatus: null,
}

// Auto-clear an abandoned cut/copy marker after 30 seconds so the
// marching-ants overlay doesn't outlive its usefulness. The timeout
// closure lives at module level so each store can hold a single
// outstanding timer and replace it on every fresh setClipboardMarker.
const CLIPBOARD_MARKER_TTL_MS = 30_000

export function createGridStore(deps: GridStoreDeps): GridStoreApi {
    const refs: GridRefs = {
        editCursor: { current: { start: 0, end: 0 } },
        lastRefSlice: { current: null },
    }

    // Per-store timeout id for the auto-clear on abandoned cut/copy.
    // Held in a closure so each store has its own and a fresh
    // setClipboardMarker cancels the previous timer cleanly.
    let clipboardTimeout: ReturnType<typeof setTimeout> | null = null

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

        // currentSelectionRange returns the active selection rectangle
        // (range when set, otherwise the single anchor cell) or null
        // when nothing is selected. Shared by mergeSelection variants
        // and unmergeSelection so the "what's currently selected" rule
        // lives in one place.
        const currentSelectionRange = (): CellRange | null => {
            const state = get()
            if (state.selected == null) return null
            if (state.selectionRange != null) return state.selectionRange
            return {
                startRow: state.selected.row,
                endRow: state.selected.row,
                startCol: state.selected.col,
                endCol: state.selected.col,
            }
        }

        // runMerge dispatches the three merge variants (all / per-row /
        // per-col). 'all' commits the whole expanded rectangle; the
        // per-axis variants iterate the perpendicular axis and emit one
        // single-row or single-col merge per step.
        const runMerge = (mode: 'all' | 'horizontal' | 'vertical') => {
            if (deps.readOnly) return
            const baseRange = currentSelectionRange()
            if (baseRange == null) return
            const expanded = deps.expandRangeOverMerges(baseRange)
            if (mode === 'all') {
                if (
                    expanded.startRow === expanded.endRow &&
                    expanded.startCol === expanded.endCol
                ) {
                    return
                }
                deps.mergeRange(expanded)
            } else if (mode === 'horizontal') {
                if (expanded.startCol === expanded.endCol) return
                for (let r = expanded.startRow; r <= expanded.endRow; r++) {
                    deps.mergeRange({
                        startRow: r,
                        endRow: r,
                        startCol: expanded.startCol,
                        endCol: expanded.endCol,
                    })
                }
            } else {
                if (expanded.startRow === expanded.endRow) return
                for (let c = expanded.startCol; c <= expanded.endCol; c++) {
                    deps.mergeRange({
                        startRow: expanded.startRow,
                        endRow: expanded.endRow,
                        startCol: c,
                        endCol: c,
                    })
                }
            }
            set({
                selected: { row: expanded.startRow, col: expanded.startCol },
                selectionRange: null,
                selectionScope: 'cells',
                contextTarget: null,
            })
        }

        return {
            ...initialState,

            selectCell: cell => {
                // Snap to the merge anchor when the click landed on a
                // covered cell — covered cells render nothing of their
                // own and only the anchor is interactable.
                const snapped = deps.resolveMergeAnchor(cell.row, cell.col)
                const target: SelectedCell = { row: snapped.row, col: snapped.col }
                commitInflight(target)
                refs.lastRefSlice.current = null
                // If a comment popover is open and the user picks a
                // different cell, dismiss it — the popover is anchored
                // to a single cell and the new selection means the user
                // moved on. Same cell click is still a no-op for the
                // popover.
                const prevCommentTarget = get().commentTarget
                const closeComment =
                    prevCommentTarget != null &&
                    (prevCommentTarget.cell.row !== target.row ||
                        prevCommentTarget.cell.col !== target.col)
                set({
                    selected: target,
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
                const naive: CellRange = {
                    startRow: Math.min(anchor.row, cell.row),
                    endRow: Math.max(anchor.row, cell.row),
                    startCol: Math.min(anchor.col, cell.col),
                    endCol: Math.max(anchor.col, cell.col),
                }
                // Grow over any merges the rectangle straddles so a
                // shift-click into the middle of a merged cell still
                // selects the full merge footprint.
                const range = deps.expandRangeOverMerges(naive)
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

            setFrozenRows: n => {
                if (deps.readOnly) return
                deps.setFrozenRows(Math.max(0, Math.floor(n)))
            },

            setFrozenCols: n => {
                if (deps.readOnly) return
                deps.setFrozenCols(Math.max(0, Math.floor(n)))
            },

            unfreeze: () => {
                if (deps.readOnly) return
                deps.setFrozenRows(0)
                deps.setFrozenCols(0)
            },

            setClipboardMarker: (markerId, sourceRange, isCut) => {
                if (clipboardTimeout != null) clearTimeout(clipboardTimeout)
                clipboardTimeout = setTimeout(() => {
                    set({
                        clipboardMarker: null,
                        copySourceRange: null,
                        cutPending: false,
                    })
                    clipboardTimeout = null
                }, CLIPBOARD_MARKER_TTL_MS)
                set({
                    clipboardMarker: markerId,
                    copySourceRange: sourceRange,
                    cutPending: isCut,
                })
            },

            clearClipboardMarker: () => {
                if (clipboardTimeout != null) {
                    clearTimeout(clipboardTimeout)
                    clipboardTimeout = null
                }
                set({
                    clipboardMarker: null,
                    copySourceRange: null,
                    cutPending: false,
                })
            },

            openSortDialog: () => set({ sortDialogOpen: true, contextTarget: null }),
            closeSortDialog: () => set({ sortDialogOpen: false }),
            openFilterDropdown: col => set({ filterDropdownCol: col, contextTarget: null }),
            closeFilterDropdown: () => set({ filterDropdownCol: null }),
            setSortStatus: status => set({ sortStatus: status }),

            // Fill-handle drag actions. The interesting bit is the
            // *direction lock*: the dot can be dragged into either of
            // four quadrants relative to the source's bottom-right
            // corner, but v1 only fills down or right. Until the user
            // moves strictly past the source's bottom or right edge,
            // the drag is a no-op (destRange == sourceRange) and the
            // direction stays "unlocked" — the placeholder 'down' has
            // no observable effect because no cells are written. On
            // the first move that escapes the source rectangle in a
            // positive axis, we lock direction to whichever axis is
            // larger (ties pick 'down', matching the placeholder).
            // Once locked, the OTHER axis is pinned to the source's
            // bounds for the rest of the drag — Sheets refuses to
            // switch axes mid-drag, and so do we. A drag-back into
            // the source collapses destRange to sourceRange but keeps
            // the lock; if the user then drags out again on the same
            // axis, the existing lock applies; on the perpendicular
            // axis, the lock holds and the drag is ignored on that
            // axis until they restart the gesture.
            fillDragStart: () => {
                if (deps.readOnly) return false
                const state = get()
                if (state.selected == null) return false
                const sourceRange = effectiveRange(state.selected, state.selectionRange)
                if (sourceRange == null) return false
                set({
                    fillDrag: {
                        sourceRange,
                        destRange: sourceRange,
                        direction: 'down',
                        directionLocked: false,
                    },
                })
                return true
            },

            fillDragMove: target => {
                const drag = get().fillDrag
                if (drag == null) return
                const { sourceRange, direction, directionLocked } = drag
                const dRow = target.row - sourceRange.endRow
                const dCol = target.col - sourceRange.endCol

                // Drag-back into source (or above/left of it) — clamp
                // dest to source. Direction lock, if any, is preserved.
                if (dRow <= 0 && dCol <= 0) {
                    if (rangesEqual(drag.destRange, sourceRange)) return
                    set({ fillDrag: { ...drag, destRange: { ...sourceRange } } })
                    return
                }

                let nextDirection = direction
                let nextLocked = directionLocked
                if (!directionLocked) {
                    // First escape from the source rectangle: lock to
                    // the dominant axis. Ties go to 'down', matching
                    // the placeholder.
                    nextDirection = dRow >= dCol ? 'down' : 'right'
                    nextLocked = true
                }

                // Once locked, the perpendicular axis is pinned to
                // source bounds. If the locked axis isn't extended
                // (e.g. user is dragging right but we're locked to
                // 'down'), the drag is a no-op on this axis.
                let destRange: CellRange
                if (nextDirection === 'down') {
                    if (dRow <= 0) {
                        if (
                            rangesEqual(drag.destRange, sourceRange) &&
                            directionLocked === nextLocked &&
                            direction === nextDirection
                        ) {
                            return
                        }
                        set({
                            fillDrag: {
                                sourceRange,
                                destRange: { ...sourceRange },
                                direction: nextDirection,
                                directionLocked: nextLocked,
                            },
                        })
                        return
                    }
                    destRange = {
                        startRow: sourceRange.startRow,
                        endRow: target.row,
                        startCol: sourceRange.startCol,
                        endCol: sourceRange.endCol,
                    }
                } else {
                    if (dCol <= 0) {
                        if (
                            rangesEqual(drag.destRange, sourceRange) &&
                            directionLocked === nextLocked &&
                            direction === nextDirection
                        ) {
                            return
                        }
                        set({
                            fillDrag: {
                                sourceRange,
                                destRange: { ...sourceRange },
                                direction: nextDirection,
                                directionLocked: nextLocked,
                            },
                        })
                        return
                    }
                    destRange = {
                        startRow: sourceRange.startRow,
                        endRow: sourceRange.endRow,
                        startCol: sourceRange.startCol,
                        endCol: target.col,
                    }
                }

                if (
                    rangesEqual(destRange, drag.destRange) &&
                    direction === nextDirection &&
                    directionLocked === nextLocked
                ) {
                    return
                }
                set({
                    fillDrag: {
                        sourceRange,
                        destRange,
                        direction: nextDirection,
                        directionLocked: nextLocked,
                    },
                })
            },

            fillDragEnd: () => {
                const drag = get().fillDrag
                if (drag == null) return
                const { sourceRange, destRange, direction } = drag
                if (rangesEqual(destRange, sourceRange)) {
                    set({ fillDrag: null })
                    return
                }
                deps.applyFill({ sourceRange, destRange, direction })
                // Post-fill selection covers the entire dest
                // rectangle; collapse to a null range when dest is
                // somehow a single cell so the rest of the store
                // stays in canonical form (matches selectCell /
                // extendSelectionTo).
                const single =
                    destRange.startRow === destRange.endRow &&
                    destRange.startCol === destRange.endCol
                set({
                    selected: { row: destRange.startRow, col: destRange.startCol },
                    selectionRange: single ? null : { ...destRange },
                    selectionScope: 'cells',
                    fillDrag: null,
                })
            },

            mergeSelection: () => {
                runMerge('all')
            },

            mergeSelectionHorizontal: () => {
                runMerge('horizontal')
            },

            mergeSelectionVertical: () => {
                runMerge('vertical')
            },

            unmergeSelection: () => {
                if (deps.readOnly) return
                const baseRange = currentSelectionRange()
                if (baseRange == null) return
                for (const m of deps.findMergesInRange(baseRange)) {
                    deps.unmergeAt(m.anchorRow, m.anchorCol)
                }
                set({ contextTarget: null })
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
