import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import type * as Y from 'yjs'
import type { CellRange } from '../hooks/grid-store'
import { setYCellStyle } from '../hooks/use-y-cell'
import { forEachCellInRange } from './selection-range'
import type { CellBorders } from './workbook-types'

// Border presets exposed by the toolbar's BordersMenu. The id is what
// the menu sends to setBorders; resolveBorderPatch translates it into
// the per-cell CellBorders patch that should land on a specific (row,
// col) inside the active range.
//
// Treat the range as a single block: presets that draw an outline
// (outer, top, bottom) only set the relevant edge on the cells along
// that edge of the range, and leave other cells (and other edges)
// untouched so any pre-existing borders survive. `all` paints a full
// grid (every cell, all four sides true). `none` is the only preset
// that explicitly clears — it stamps all four false on every selected
// cell, so it doubles as a "reset" affordance.
export type BorderPresetId = 'all' | 'outer' | 'top' | 'bottom' | 'none'

// Returns the CellBorders patch for one cell at (row, col) inside
// `range` for the given preset. Returns null when the preset has no
// effect on that cell (e.g. an interior cell under "outer" or "top"),
// signalling the caller to skip writing — important because writing an
// empty patch would still create a Y.Map style entry on a previously
// unstyled cell.
export function resolveBorderPatch(
    presetId: BorderPresetId,
    range: CellRange,
    row: number,
    col: number
): CellBorders | null {
    if (presetId === 'all') {
        return { top: true, right: true, bottom: true, left: true }
    }
    if (presetId === 'none') {
        return { top: false, right: false, bottom: false, left: false }
    }
    const isTopRow = row === range.startRow
    const isBottomRow = row === range.endRow
    const isLeftCol = col === range.startCol
    const isRightCol = col === range.endCol
    if (presetId === 'top') {
        return isTopRow ? { top: true } : null
    }
    if (presetId === 'bottom') {
        return isBottomRow ? { bottom: true } : null
    }
    // outer — only the cells on the perimeter contribute, and each
    // contributes only the side(s) facing outward. A 1x1 range gets
    // all four edges (every side faces outward).
    const patch: CellBorders = {}
    if (isTopRow) patch.top = true
    if (isBottomRow) patch.bottom = true
    if (isLeftCol) patch.left = true
    if (isRightCol) patch.right = true
    if (
        patch.top == null &&
        patch.bottom == null &&
        patch.left == null &&
        patch.right == null
    ) {
        return null
    }
    return patch
}

// applyBorderPreset writes the resolved per-cell patches inside one
// yjs transaction so the whole range-write is a single undo step.
export function applyBorderPreset(
    doc: Y.Doc | null,
    sheetId: string,
    range: CellRange,
    presetId: BorderPresetId
): void {
    if (doc == null) return
    doc.transact(() => {
        forEachCellInRange(range, (row, col) => {
            const patch = resolveBorderPatch(presetId, range, row, col)
            if (patch == null) return
            setYCellStyle(doc, sheetId, row, col, { borders: patch })
        })
    }, LOCAL_ORIGIN)
}
