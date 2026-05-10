// CellStyle mirrors the OOXML / SpreadsheetML cell-style shape that
// excelize uses natively on the server side, so attributes copy
// through with minimal translation when the server reads the source
// .xlsx into a WorkbookModel and again when SaveRoom writes the doc
// back out.
//
// Every field is optional, and every nested group is optional. Absence
// is significant: a missing field means "this attribute is not tracked
// by the doc", which the serializer interprets as "leave whatever the
// source .xlsx already has on that attribute alone". This is what
// allows the doc to carry (e.g.) only bold without overwriting an
// existing fill color the source workbook had.
//
// Today only `font.bold` is wired all the way through. New attributes
// land additively: add a field here, mirror it in CellStyle (Go),
// teach the server reader to extract it, and teach the serializer's
// per-group merger to apply it. Nothing in between needs to know.
export interface CellFont {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    size?: number
    name?: string
    color?: string
}

export interface CellFill {
    type?: 'pattern'
    pattern?: string
    fgColor?: string
    bgColor?: string
}

export interface CellAlignment {
    horizontal?: 'left' | 'center' | 'right'
    vertical?: 'top' | 'middle' | 'bottom'
    wrapText?: boolean
}

// CellBorders stores edge presence as four booleans. Width and color
// are uniform (1px, foreground) for now — matching the simple
// "borders dropdown" affordance the toolbar exposes. A future
// per-edge color/style picker can grow these into objects without
// schema breakage (the deep-merge in setYCellStyle treats any object
// patch additively).
export interface CellBorders {
    top?: boolean
    right?: boolean
    bottom?: boolean
    left?: boolean
}

export interface CellStyle {
    font?: CellFont
    fill?: CellFill
    alignment?: CellAlignment
    borders?: CellBorders
    numFmt?: string
}

// CellKind tags the semantic type of a cell's value, separate from
// `typeof raw`, so an ISO date string ("2024-01-15") is distinguishable
// from a literal text "2024-01-15" the user prepended `'` to. The Go
// serializer dispatches on `kind` to pick excelize's number / boolean /
// date / formula write path. See ~/Documents/plans/2026-05-08-calc-cell-types.md.
export type CellKind = 'string' | 'number' | 'boolean' | 'date' | 'formula'

// CellRaw is the in-doc representation of a cell's value, constrained
// to types Yjs serializes natively. Dates are stored as ISO strings
// (Yjs doesn't serialize JS Date), formulas store `null` (or a cached
// scalar from xlsx import) since the formula text lives separately.
export type CellRaw = string | number | boolean | null

export interface CellValue {
    kind: CellKind
    raw: CellRaw | Date
    display: string
    formula?: string
    style?: CellStyle
}

// formatCell computes the user-visible text for a cell from its kind,
// raw value, optional formula text, and optional numFmt. Used by both
// the xlsx-import path (to populate the `display` cache written to the
// doc) and the live render path. The cache call sites pass no numFmt
// — the cache is the kind-only baseline so old peers and serializers
// still render correctly. The live render path passes
// cell.style?.numFmt so any applied format takes effect immediately.
//
// The implementation lives in lib/number-format/format.ts; this
// wrapper preserves the (kind, raw, formula?) signature existing
// callers were built against.
import { applyNumFmt } from './number-format/format'

export function formatCell(
    kind: CellKind,
    raw: CellRaw | Date,
    formula?: string,
    numFmt?: string
): string {
    return applyNumFmt(kind, raw, numFmt, formula)
}

export interface WorksheetModel {
    name: string
    rowCount: number
    colCount: number
    cells: Record<string, CellValue>
    // Optional tab color (e.g. "#FF0000"). Imported from the source
    // xlsx; absent when the source has no tab color set.
    color?: string
    // Optional hidden flag. When true, useYSheets filters this sheet
    // out of the public list while the sheet-management UI still sees
    // it via useAllYSheets.
    hidden?: boolean
    // Optional list of merged cell rectangles. Imported from xlsx via
    // excelize's GetMergeCells; persisted back via MergeCell. Absent on
    // sheets without merges.
    merges?: MergeRangeModel[]
}

export interface MergeRangeModel {
    anchorRow: number
    anchorCol: number
    rowSpan: number
    colSpan: number
}

export interface WorkbookModel {
    sheets: WorksheetModel[]
}

export function cellKey(row: number, col: number): string {
    return `${row}:${col}`
}

export function columnLabel(col: number): string {
    let n = col
    let label = ''
    while (n > 0) {
        const rem = (n - 1) % 26
        label = String.fromCharCode(65 + rem) + label
        n = Math.floor((n - 1) / 26)
    }
    return label || 'A'
}
