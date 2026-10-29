interface ScrollView {
    scrollX: number
    scrollY: number
    // Size of the scrolling (bottom-right) area, frozen panes excluded.
    width: number
    height: number
}

// scrollIntoView returns the scroll offsets that bring a cell into the
// scrolling area with the least movement, or {} on an axis where it is
// already visible. Offsets are in the scrolling area's own coordinates,
// which start after the frozen columns/rows; a cell inside the frozen
// panes is always visible, so it never scrolls that axis.
export function scrollIntoView(
    cell: { row: number; col: number },
    colOffsets: Float64Array,
    rowOffsets: Float64Array,
    view: ScrollView,
    frozenRows: number,
    frozenCols: number
): { x?: number; y?: number } {
    const out: { x?: number; y?: number } = {}
    const x = axisTarget(cell.col, colOffsets, frozenCols, view.scrollX, view.width)
    if (x != null) out.x = x
    const y = axisTarget(cell.row, rowOffsets, frozenRows, view.scrollY, view.height)
    if (y != null) out.y = y
    return out
}

function axisTarget(
    index: number,
    offsets: Float64Array,
    frozen: number,
    scroll: number,
    size: number
): number | null {
    // An unmeasured area (size 0, before first layout) has no edges to
    // compare against.
    if (size <= 0 || index <= frozen || index >= offsets.length) return null
    const frozenExtent = offsets[frozen] ?? 0
    const start = offsets[index - 1] - frozenExtent
    const end = offsets[index] - frozenExtent
    if (start < scroll) return start
    if (end > scroll + size) return Math.max(0, Math.min(start, end - size))
    return null
}
