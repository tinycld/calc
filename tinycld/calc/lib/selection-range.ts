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
