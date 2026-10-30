// overflowRoom is how far past its right edge a cell's text may draw:
// the total width of the empty cells that follow it in the row, up to
// the next filled cell or `lastCol`. Sheets and Excel let left-aligned
// text run on into empty neighbors instead of cutting it off.
export function overflowRoom(
    row: number,
    col: number,
    colOffsets: Float64Array,
    lastCol: number,
    isFilled: (row: number, col: number) => boolean
): number {
    let end = col
    while (end < lastCol && !isFilled(row, end + 1)) end++
    return (colOffsets[end] ?? 0) - (colOffsets[col] ?? 0)
}
