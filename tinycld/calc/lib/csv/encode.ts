import type * as Y from 'yjs'
import type { CellKind } from '../workbook-types'
import { formatCell } from '../workbook-types'
import { yCellKey } from '../y-cell-key'
import { CELLS_MAP, readYCell } from '../y-doc-bootstrap'

// serializeSheetToCsv writes the active rectangular extent of a sheet
// as RFC 4180 CSV text. The extent is computed from the maximum row /
// column actually populated in the Y.Doc (NOT the meta rowCount /
// colCount, which the renderer pads up to MIN_ROWS / MIN_COLS); trailing
// empty rows AND trailing empty columns are trimmed so a sheet with one
// cell at (1,1) yields one CSV line, not 50.
//
// useDisplay: true (default) writes the cell's `display` cache — the
// formatted text the user sees on screen, e.g. "$1,234.56" for a
// currency cell or "TRUE" for a boolean. useDisplay: false writes the
// raw scalar's string form, suitable for round-trip into a parser that
// re-detects types.
//
// Line terminator is CRLF per RFC 4180. Quoting wraps any field that
// contains the delimiter, `"`, `\r`, or `\n`; embedded `"` are doubled.
//
// CSV / formula injection: a cell whose text begins with `=`, `+`, `-`,
// `@`, TAB, or CR is interpreted as a FORMULA by Excel / Google Sheets
// when the exported file is opened, so a payload like `=cmd|'/c calc'!A1`
// or `=HYPERLINK(...)` executes on the victim's machine. We neutralize
// this per OWASP guidance by prefixing a single quote `'` (forcing the
// spreadsheet to treat the value as text) BEFORE the RFC-4180 quoting
// runs, so the `'` lands inside the quoted field when quoting applies.
// Neutralization is gated on the cell KIND: only text-bearing cells
// (`string` and `formula`) can carry an attacker-controlled leading
// character, so number / boolean / date cells are never touched and a
// legitimate `-5` exports unchanged.

export type CsvDelimiter = ',' | '\t' | ';'

export interface SerializeCsvOptions {
    delimiter?: CsvDelimiter
    useDisplay?: boolean
}

const ROW_SEP = '\r\n'

export function serializeSheetToCsv(
    doc: Y.Doc,
    sheetId: string,
    opts: SerializeCsvOptions = {}
): string {
    const delimiter: CsvDelimiter = opts.delimiter ?? ','
    const useDisplay = opts.useDisplay ?? true

    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

    // Walk every cell once to find the actual populated extent and to
    // bucket the values for emission. This is O(N) over all cells in
    // the doc but each cell touch is a hash lookup so practical sheets
    // (10s of thousands of cells) stay fast.
    let maxRow = 0
    let maxCol = 0
    const values = new Map<string, string>()
    cellsMap.forEach((cell, key) => {
        // Skip cells from other sheets — keys are "<sheetId>:<row>:<col>".
        if (!key.startsWith(`${sheetId}:`)) return
        const parts = key.split(':')
        if (parts.length !== 3) return
        const row = Number(parts[1])
        const col = Number(parts[2])
        if (!Number.isFinite(row) || !Number.isFinite(col)) return
        const text = renderCsvCell(cell, useDisplay)
        if (text === '') return
        if (row > maxRow) maxRow = row
        if (col > maxCol) maxCol = col
        values.set(yCellKey(sheetId, row, col), text)
    })

    if (maxRow === 0 || maxCol === 0) return ''

    const lines: string[] = []
    for (let r = 1; r <= maxRow; r++) {
        const parts: string[] = []
        for (let c = 1; c <= maxCol; c++) {
            const text = values.get(yCellKey(sheetId, r, c)) ?? ''
            parts.push(escapeCsvField(text, delimiter))
        }
        lines.push(parts.join(delimiter))
    }
    return lines.join(ROW_SEP)
}

function renderCsvCell(cell: Y.Map<unknown>, useDisplay: boolean): string {
    const snap = readYCell(cell)
    const text = renderCsvCellText(snap, useDisplay)
    return neutralizeFormulaInjection(text, snap.kind)
}

function renderCsvCellText(
    snap: { kind: CellKind; raw: unknown; display?: string },
    useDisplay: boolean
): string {
    if (useDisplay) return snap.display ?? ''
    // Raw mode: emit the scalar without numFmt formatting. Formula
    // cells with no cached value emit empty (the formula text itself
    // belongs in display-mode fallback, not raw).
    if (snap.raw == null) return ''
    if (typeof snap.raw === 'boolean') return snap.raw ? 'TRUE' : 'FALSE'
    if (typeof snap.raw === 'number') return formatCell('number', snap.raw)
    return String(snap.raw)
}

// Characters that, when leading a cell, make Excel / Google Sheets
// evaluate the cell as a formula on open — the OWASP CSV-injection set.
const DANGEROUS_LEADING = new Set(['=', '+', '-', '@', '\t', '\r'])

// neutralizeFormulaInjection prefixes a single quote `'` to a field
// whose first character would trigger formula evaluation, so the
// spreadsheet app treats it as literal text. Applied BEFORE CSV
// quoting so the `'` sits inside the quoted field when quoting runs.
//
// Gating: only `string` and `formula` cells carry attacker-controlled
// text, so number / boolean / date cells are returned untouched (a
// legitimate `-5` numeric cell must not become the text `'-5`). As a
// defence-in-depth belt for the text kinds, a leading `-`/`+` that
// forms a plain number (e.g. a numeric-looking string cell) is also
// left alone — a pure number can't be a formula, and the real vectors
// there are `=` / `@` / TAB / CR. `=` / `@` / TAB / CR always
// neutralize regardless of numeric shape.
export function neutralizeFormulaInjection(field: string, kind?: CellKind): string {
    if (field === '') return field
    if (kind === 'number' || kind === 'boolean' || kind === 'date') return field
    const first = field[0]
    if (!DANGEROUS_LEADING.has(first)) return field
    if ((first === '-' || first === '+') && isPlainNumber(field)) return field
    return `'${field}`
}

function isPlainNumber(field: string): boolean {
    return field.trim() !== '' && !Number.isNaN(Number(field))
}

function escapeCsvField(text: string, delimiter: CsvDelimiter): string {
    if (text === '') return ''
    if (needsQuoting(text, delimiter)) {
        return `"${text.replace(/"/g, '""')}"`
    }
    return text
}

function needsQuoting(text: string, delimiter: CsvDelimiter): boolean {
    if (text.indexOf(delimiter) !== -1) return true
    if (text.indexOf('"') !== -1) return true
    if (text.indexOf('\r') !== -1) return true
    if (text.indexOf('\n') !== -1) return true
    return false
}
