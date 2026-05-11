// CellRange helpers — small, dependency-free utilities for normalizing
// and iterating a selected rectangle of cells. Lives in lib/ (not the
// store) so the toolbar callbacks, style helpers, and tests can import
// without pulling Zustand into their dependency graph.

import type { CellRange, SelectedCell } from '../hooks/grid-store'

// rangeContainsCell returns true if (row, col) falls inside the
// inclusive bounds of `range`. Used by openCellContextMenu to decide
// whether a right-click should keep an existing range or collapse to a
// single-cell selection.
export function rangeContainsCell(range: CellRange, row: number, col: number): boolean {
    return (
        row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol
    )
}

// effectiveRange resolves the range that format/clear actions should
// apply to. When `selectionRange` is set, that's the range. When it's
// null but `selected` exists, the range is just the single anchor
// cell. When neither exists, returns null — callers should no-op.
export function effectiveRange(
    selected: SelectedCell | null,
    selectionRange: CellRange | null
): CellRange | null {
    if (selectionRange != null) return selectionRange
    if (selected == null) return null
    return {
        startRow: selected.row,
        endRow: selected.row,
        startCol: selected.col,
        endCol: selected.col,
    }
}

// rangeCellCount is the inclusive cell count of a range. Used by
// callers that want to short-circuit when a single-cell range is
// effectively a point selection (e.g. the formula bar always reads
// from the anchor regardless of range size).
export function rangeCellCount(range: CellRange): number {
    return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1)
}

// forEachCellInRange invokes `fn(row, col)` for every cell inside the
// inclusive bounds of `range`, row-major. Used for style applications
// over a multi-cell selection so the caller doesn't have to write the
// nested loop each time.
export function forEachCellInRange(range: CellRange, fn: (row: number, col: number) => void): void {
    for (let r = range.startRow; r <= range.endRow; r++) {
        for (let c = range.startCol; c <= range.endCol; c++) {
            fn(r, c)
        }
    }
}

// shiftIndexForInsert returns the new row/col index after `count` rows
// or columns are inserted at `insertAt` (1-based). Indices < insertAt
// stay put; indices >= insertAt shift right/down by `count`. Pure
// arithmetic — caller decides whether to apply to anchor, range, or
// both. `insertAt` is the absolute insert position: for "insert N rows
// above row K", insertAt=K; for "below row K", insertAt=K+1.
export function shiftIndexForInsert(index: number, insertAt: number, count: number): number {
    return index >= insertAt ? index + count : index
}

// shiftRangeForInsert applies shiftIndexForInsert to a CellRange's
// start/end on a single axis. Pass `axis: 'row'` to shift startRow /
// endRow; 'col' for startCol / endCol. Returns a new range; the
// untouched axis is copied through.
export function shiftRangeForInsert(
    range: CellRange,
    axis: 'row' | 'col',
    insertAt: number,
    count: number
): CellRange {
    if (axis === 'row') {
        return {
            startRow: shiftIndexForInsert(range.startRow, insertAt, count),
            endRow: shiftIndexForInsert(range.endRow, insertAt, count),
            startCol: range.startCol,
            endCol: range.endCol,
        }
    }
    return {
        startRow: range.startRow,
        endRow: range.endRow,
        startCol: shiftIndexForInsert(range.startCol, insertAt, count),
        endCol: shiftIndexForInsert(range.endCol, insertAt, count),
    }
}

// clampIndexForDelete returns the new row/col index after `count` rows
// or columns are deleted starting at `fromIndex` (1-based) on a sheet
// whose post-delete extent is `newAxisCount`. Indices before the
// deletion site stay put; indices past the deleted range shift left /
// up by `count`. Indices that fell *inside* the deleted range snap to
// the first surviving slot at the deletion site, clamped into the new
// bounds — same rule as the original handle/selection delete actions.
export function clampIndexForDelete(
    index: number,
    fromIndex: number,
    count: number,
    newAxisCount: number
): number {
    if (index < fromIndex) return index
    if (index >= fromIndex + count) return index - count
    return Math.min(fromIndex, newAxisCount)
}
