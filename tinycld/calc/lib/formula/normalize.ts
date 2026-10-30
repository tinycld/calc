import type { CellValue, DetailedCellError, RawCellContent } from 'hyperformula'
import type { CellRaw } from '../workbook-types'
import type { YCellValue } from '../y-doc-bootstrap'

// hfInputForCell converts a Y.Doc cell snapshot into the value
// HyperFormula expects via setCellContents. HyperFormula parses any
// string it receives the way it parses typed input, so each kind is
// handed over in a form that cannot be re-read as something else:
//
//   - formula cells -> the formula text ('=SUM(A1:A2)')
//   - string cells -> the text behind a leading apostrophe, which HF
//     strips; without it, text such as "12/6/24", "TRUE" or "=x" would
//     become a date, a boolean or a formula inside the engine
//   - date cells -> "YYYY-MM-DD[ hh:mm:ss]", a date format the engine
//     is configured to read (HYPERFORMULA_CONFIG), so date math works
//     and results carry a date type
//   - number/boolean -> the raw scalar
export function hfInputForCell(cell: YCellValue | null): RawCellContent {
    if (cell == null) return null
    if (cell.kind === 'formula') {
        return cell.formula ?? null
    }
    if (cell.raw == null) return null
    if (cell.kind === 'string' && typeof cell.raw === 'string') {
        return cell.raw === '' ? null : `'${cell.raw}`
    }
    if (cell.kind === 'date' && typeof cell.raw === 'string') {
        return isoToEngineDate(cell.raw)
    }
    return cell.raw
}

// isoToEngineDate drops the "T" separator and any zone suffix: doc
// date-times are wall-clock values (see number-format/format.ts).
function isoToEngineDate(iso: string): string {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?))?/.exec(iso)
    if (match == null) return `'${iso}`
    return match[2] == null ? match[1] : `${match[1]} ${match[2]}`
}

// normalizeHfValue converts a HyperFormula cell value (the type of
// ExportedCellChange.newValue) into our CellRaw shape.
//
//   - number/string/boolean -> pass through
//   - DetailedCellError (#DIV/0!, #REF!, #NAME?, etc.) -> the .value
//     string. formatCell renders string raws on formula cells directly,
//     so the error text appears in the grid
//   - null/undefined -> null
//
// HF's date semantics aren't enabled in the PoC, so number values that
// represent dates would arrive as raw numbers. That's fine: SUM of
// numbers is what users expect from the SUM/AVG PoC.
export function normalizeHfValue(value: CellValue | undefined): CellRaw {
    if (value == null) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') return value
    if (typeof value === 'boolean') return value
    // DetailedCellError instance — surface its display string. Use
    // duck-typing on .value rather than instanceof so we don't have to
    // import the class just to narrow the type.
    if (typeof (value as DetailedCellError).value === 'string') {
        return (value as DetailedCellError).value
    }
    return null
}
