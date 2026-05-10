import type * as Y from 'yjs'
import {
    readColWidthsFromMeta,
    readRowHeightsFromMeta,
    type ColWidths,
    type RowHeights,
} from '../dimensions'
import type { CellStyle } from '../workbook-types'
import { yCellKey } from '../y-cell-key'
import {
    CELLS_MAP,
    readYCell,
    SHEETS_MAP,
    ydocSheetIds,
} from '../y-doc-bootstrap'

// PrintCell is the minimal per-cell shape the renderer needs. It does
// NOT carry `raw` or `formula` — the renderer prints `display` (the
// formatted text the user sees on screen), matching CalcPreview and
// the CSV-export "useDisplay: true" default.
export interface PrintCell {
    display: string
    style?: CellStyle
}

// rowOffset / colOffset are the 1-based absolute coordinates of the
// top-left of the slice in the source sheet (used to render the
// row/column headers with the right labels when showHeaders is on).
// rowCount / colCount are the slice dimensions. cells is keyed by
// "<absRow>:<absCol>".
export interface PrintSheet {
    id: string
    name: string
    rowOffset: number
    colOffset: number
    rowCount: number
    colCount: number
    cells: Map<string, PrintCell>
    colWidths: ColWidths | undefined
    rowHeights: RowHeights | undefined
}

export interface PrintSnapshot {
    sheets: PrintSheet[]
}

export interface PrintSelection {
    sheetId: string
    rect: { startRow: number; startCol: number; endRow: number; endCol: number }
}

export interface SnapshotForPrintArgs {
    sheetsScope: 'current' | 'all' | { ids: string[] }
    currentSheetId: string
    range: 'used' | 'selection'
    currentSelection: PrintSelection | null
}

// snapshotForPrint reads the live Y.Doc once and produces a typed
// snapshot the renderer can walk without any Yjs dependency.
//
// Selection fallback: if the user picked range='selection' but the
// current selection is null or belongs to a different sheet than the
// one being printed, fall back to the used range for that sheet. This
// matches Sheets' behavior — printing always produces SOME output
// rather than failing.
export function snapshotForPrint(
    doc: Y.Doc,
    args: SnapshotForPrintArgs,
): PrintSnapshot {
    const sheetIds = pickSheetIds(doc, args.sheetsScope, args.currentSheetId)
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

    const sheets: PrintSheet[] = []

    for (const sheetId of sheetIds) {
        const meta = sheetsMap.get(sheetId)
        if (meta == null) continue
        const name = (meta.get('name') as string) ?? 'Sheet'

        // Selection scope: rectangle is only meaningful for the sheet
        // that owns it. If we're printing a different sheet, fall back
        // to that sheet's used range.
        const useSelection =
            args.range === 'selection' &&
            args.currentSelection != null &&
            args.currentSelection.sheetId === sheetId

        let rect: {
            startRow: number
            startCol: number
            endRow: number
            endCol: number
        } | null = useSelection ? args.currentSelection!.rect : null

        if (rect == null) {
            rect = computeUsedRange(cellsMap, sheetId)
        }

        if (rect == null) {
            sheets.push(emptySheet(sheetId, name, meta))
            continue
        }

        const cells = new Map<string, PrintCell>()
        for (let r = rect.startRow; r <= rect.endRow; r++) {
            for (let c = rect.startCol; c <= rect.endCol; c++) {
                const cell = cellsMap.get(yCellKey(sheetId, r, c))
                if (cell == null) continue
                const snap = readYCell(cell)
                if (snap.display === '' && snap.style == null) continue
                cells.set(`${r}:${c}`, {
                    display: snap.display,
                    style: snap.style,
                })
            }
        }

        sheets.push({
            id: sheetId,
            name,
            rowOffset: rect.startRow,
            colOffset: rect.startCol,
            rowCount: rect.endRow - rect.startRow + 1,
            colCount: rect.endCol - rect.startCol + 1,
            cells,
            colWidths: readColWidthsFromMeta(meta),
            rowHeights: readRowHeightsFromMeta(meta),
        })
    }

    return { sheets }
}

function pickSheetIds(
    doc: Y.Doc,
    scope: SnapshotForPrintArgs['sheetsScope'],
    currentSheetId: string,
): string[] {
    if (scope === 'current') return [currentSheetId]
    if (scope === 'all') return ydocSheetIds(doc)
    const all = new Set(ydocSheetIds(doc))
    return scope.ids.filter(id => all.has(id))
}

function computeUsedRange(
    cellsMap: Y.Map<Y.Map<unknown>>,
    sheetId: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
    let maxRow = 0
    let maxCol = 0
    let minRow = Number.POSITIVE_INFINITY
    let minCol = Number.POSITIVE_INFINITY
    let any = false
    const prefix = `${sheetId}:`
    cellsMap.forEach((cell, key) => {
        if (!key.startsWith(prefix)) return
        const parts = key.split(':')
        if (parts.length !== 3) return
        const row = Number(parts[1])
        const col = Number(parts[2])
        if (!Number.isFinite(row) || !Number.isFinite(col)) return
        const snap = readYCell(cell)
        if (snap.display === '' && snap.style == null) return
        any = true
        if (row > maxRow) maxRow = row
        if (col > maxCol) maxCol = col
        if (row < minRow) minRow = row
        if (col < minCol) minCol = col
    })
    if (!any) return null
    return {
        startRow: minRow,
        startCol: minCol,
        endRow: maxRow,
        endCol: maxCol,
    }
}

function emptySheet(id: string, name: string, meta: Y.Map<unknown>): PrintSheet {
    return {
        id,
        name,
        rowOffset: 1,
        colOffset: 1,
        rowCount: 0,
        colCount: 0,
        cells: new Map(),
        colWidths: readColWidthsFromMeta(meta),
        rowHeights: readRowHeightsFromMeta(meta),
    }
}
