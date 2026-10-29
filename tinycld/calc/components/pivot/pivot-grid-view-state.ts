// Pure decision helper for PivotGrid. Maps a PivotDefinition plus the
// engine result onto one of three view states (empty / error / grid)
// so the component body stays a thin renderer and the routing logic
// is testable without mounting React Native.
//
// Lives in its own .ts module (no react-native imports) so vitest can
// exercise it directly. The component file (PivotGrid.tsx) consumes
// this helper to pick between PivotEmptyState, PivotBanner, and the
// grid-cell renderer — the helper owns the decision, the .tsx owns
// the JSX.

import type { RenderedPivotResult } from '../../hooks/use-rendered-pivot'
import { AUTOSIZE_PADDING, DEFAULT_COL_WIDTH } from '../../lib/dimensions'
import type { PivotDefinition } from '../../lib/workbook-types'

export type PivotGridViewState =
    | { kind: 'empty' }
    | { kind: 'error'; error: Extract<RenderedPivotResult, { ok: false }> }
    | {
          kind: 'grid'
          rendered: Extract<RenderedPivotResult, { ok: true }>['value']
      }

// "Empty" means the user has created the pivot but hasn't dragged any
// field into rows/cols/values yet. We surface a configure-your-pivot
// CTA in that state instead of an engine error. Filter-only defs still
// count as empty — without a value field, there's nothing to compute.
export function isPivotDefinitionEmpty(def: PivotDefinition): boolean {
    return def.rows.length === 0 && def.cols.length === 0 && def.values.length === 0
}

export function selectPivotGridViewState(
    def: PivotDefinition,
    result: RenderedPivotResult
): PivotGridViewState {
    if (isPivotDefinitionEmpty(def)) return { kind: 'empty' }
    if (!result.ok) return { kind: 'error', error: result }
    return { kind: 'grid', rendered: result.value }
}

// Pure cell-iteration helper. The grid's body is a 1..rows x 1..cols
// loop pulling out engine cells and deciding how each one is styled.
// Extracted so the loop bounds + style flags can be unit-tested without
// rendering React Native primitives.
export interface PivotGridCellMeta {
    row: number
    col: number
    display: string
    // Inside the shaded header band (the top headerRowCount rows).
    isHeader: boolean
    // A row- or col-field caption, drawn italic like Sheets does.
    isFieldLabel: boolean
    // On the grand-total row, drawn bold under a rule.
    isGrandTotal: boolean
    // Numbers align right, as in the normal grid.
    isNumber: boolean
}

export function buildPivotGridCellMatrix(
    rendered: Extract<RenderedPivotResult, { ok: true }>['value']
): PivotGridCellMeta[][] {
    const rows: PivotGridCellMeta[][] = []
    for (let r = 1; r <= rendered.rows; r++) {
        const row: PivotGridCellMeta[] = []
        for (let c = 1; c <= rendered.cols; c++) {
            const key = `${r}:${c}`
            const cell = rendered.cells.get(key)
            row.push({
                row: r,
                col: c,
                display: cell?.display ?? '',
                isHeader: r <= rendered.headerRowCount,
                isFieldLabel: rendered.fieldLabelCells.has(key),
                isGrandTotal: r === rendered.grandTotalRow,
                isNumber: cell?.kind === 'number',
            })
        }
        rows.push(row)
    }
    return rows
}

// A pivot sheet has no stored column widths, so each column is sized to
// its widest text. One width per column, shared by every row, is what
// keeps the cells lined up as a grid.
export const PIVOT_MAX_COL_WIDTH = 320

const AVG_CHAR_WIDTH = 7

function measureByCharCount(text: string): number {
    return text.length * AVG_CHAR_WIDTH
}

export function pivotColumnWidths(
    matrix: PivotGridCellMeta[][],
    measure: (text: string) => number = measureByCharCount
): number[] {
    const widest: number[] = []
    for (const row of matrix) {
        row.forEach((cell, i) => {
            const w = cell.display === '' ? 0 : measure(cell.display)
            widest[i] = Math.max(widest[i] ?? 0, w)
        })
    }
    return widest.map(w =>
        Math.min(PIVOT_MAX_COL_WIDTH, Math.max(DEFAULT_COL_WIDTH, w + AUTOSIZE_PADDING))
    )
}

// True when the pivot side panel should mount alongside this sheet's
// PivotGrid. The store keys by sheet id (not pivot id) because that's
// what Grid.tsx already passes through when opening, and because the
// same pivot definition might in principle be reused across sheets in
// a future feature — the per-sheet keying keeps each grid's panel
// state independent. Extracted so PivotGrid stays a thin renderer and
// the conditional logic is testable without RN.
export function selectPivotPanelOpen(openForSheetId: string | null, sheetId: string): boolean {
    return openForSheetId != null && openForSheetId === sheetId
}
