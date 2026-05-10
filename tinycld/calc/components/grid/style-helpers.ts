import type * as Y from 'yjs'
import { setYCellStyle, type useYCell } from '../../hooks/use-y-cell'
import { firstColAtOffset, firstRowAtOffset } from '../../lib/dimensions'
import { formatCell } from '../../lib/workbook-types'
import { yCellKey } from '../../lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../../lib/y-doc-bootstrap'

// computeFormulaBarValue picks the right text to display in the
// formula bar:
//   - while editing, show the in-progress draft
//   - for formula cells, show the formula expression (so editing
//     round-trips the formula text rather than its cached result)
//   - otherwise, show the same string the cell renders
export function computeFormulaBarValue(
    editSession: { draft: string } | null,
    cell: ReturnType<typeof useYCell>,
    hasSelection: boolean
): string {
    if (editSession != null) return editSession.draft
    if (!hasSelection || cell == null) return ''
    if (cell.kind === 'formula' && cell.formula) {
        return cell.formula
    }
    return formatCell(cell.kind, cell.raw, cell.formula, cell.style?.numFmt)
}

// readCellStyle is a one-shot read of a cell's style from the Y.Doc.
// Used by handlers that need the current value to compute a toggle —
// can't use the useYCell hook from inside a callback, and subscribing
// the whole Grid to every cell change just to know whether bold is on
// would be wasteful.
export function readCellStyle(doc: Y.Doc | null, sheetId: string, row: number, col: number) {
    if (doc == null) return undefined
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)
}

// toggleCellFontAttr flips one boolean font attribute (bold or italic)
// on the cell at (row, col). Reads the current style, computes the
// negated value (treating missing as false — so an unstyled cell goes
// to true on first toggle), and writes the patch.
//
// One helper keeps the toolbar's bold/italic buttons and the cell
// context menu's bold/italic items in lockstep. Without it the two
// surfaces had identical 4-line bodies that drifted easily — e.g. one
// callsite once used `=== false` instead of `!== true`, which behaves
// differently on a missing attribute.
export function toggleCellFontAttr(
    doc: Y.Doc | null,
    sheetId: string,
    row: number,
    col: number,
    attr: 'bold' | 'italic'
): void {
    if (doc == null) return
    const current = readCellStyle(doc, sheetId, row, col)
    const next = current?.font?.[attr] !== true
    setYCellStyle(doc, sheetId, row, col, { font: { [attr]: next } })
}

// locateCellAtGridCoord maps an (x, y) inside the grid body to the
// 1-based (row, col) of the cell at that point. Used by the cell
// PanResponder to translate pointer-move locations into the cell the
// user has dragged onto. Returns null when the coordinate falls in a
// hidden (zero-width or zero-height) cell or outside the grid.
export function locateCellAtGridCoord(
    x: number,
    y: number,
    colOffsets: Float64Array,
    rowOffsets: Float64Array
): { row: number; col: number } | null {
    if (y < 0) return null
    const row = firstRowAtOffset(rowOffsets, y)
    const col = firstColAtOffset(colOffsets, x)
    if (row < 1 || col < 1) return null
    const top = rowOffsets[row - 1] ?? 0
    const bottom = rowOffsets[row] ?? top
    if (bottom - top <= 0) return null
    const left = colOffsets[col - 1] ?? 0
    const right = colOffsets[col] ?? left
    if (right - left <= 0) return null
    return { row, col }
}
