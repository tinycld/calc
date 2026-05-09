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

export interface CellStyle {
    font?: CellFont
    fill?: CellFill
    alignment?: CellAlignment
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

// formatCell computes the user-visible text for a cell from its kind
// and raw value. Used by both the xlsx-import path (to populate the
// `display` cache written to the doc) and the live render path. Phase
// 1 ships with naive defaults — numFmt-aware formatting lands in
// Phase 3.
export function formatCell(kind: CellKind, raw: CellRaw | Date, formula?: string): string {
    if (kind === 'formula') {
        // Formula cells without a cached value show the formula text
        // (matches Excel before recalculation).
        if (raw == null) return formula ?? ''
        if (typeof raw === 'string') return raw
        if (typeof raw === 'number') return formatNumber(raw)
        if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE'
        if (raw instanceof Date) return formatDateISO(raw)
        return String(raw)
    }
    if (raw == null) return ''
    switch (kind) {
        case 'string':
            return typeof raw === 'string' ? raw : String(raw)
        case 'number':
            if (typeof raw === 'number') return formatNumber(raw)
            return String(raw)
        case 'boolean':
            return raw ? 'TRUE' : 'FALSE'
        case 'date':
            if (raw instanceof Date) return formatDateISO(raw)
            if (typeof raw === 'string') return raw.length > 10 ? raw : raw
            return String(raw)
    }
}

function formatNumber(n: number): string {
    if (!Number.isFinite(n)) return String(n)
    return Number.isInteger(n) ? String(n) : n.toString()
}

function formatDateISO(d: Date): string {
    // Date-only fallback: ISO yyyy-mm-dd. If the time component is
    // non-zero we emit the full ISO (with Z), so dates with explicit
    // times round-trip identically.
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
        return d.toISOString().slice(0, 10)
    }
    return d.toISOString()
}

export interface WorksheetModel {
    name: string
    rowCount: number
    colCount: number
    cells: Record<string, CellValue>
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
