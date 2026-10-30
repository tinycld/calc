import { format, isDateFormat, isPercentFormat } from 'numfmt'
import type { CellKind, CellRaw, CellStyle } from './workbook-types'
import { formatCell } from './workbook-types'

interface EditableCell {
    kind: CellKind
    raw: CellRaw | Date
    formula?: string
    style?: CellStyle
}

const DATE_EDIT_FORMAT = 'm/d/yyyy'
const DATE_TIME_EDIT_FORMAT = 'm/d/yyyy h:mm:ss'

// cellEditText is the text the cell editor and the formula bar start
// from. It shows the value, not its display format ("639.09", not
// "$639.09"), the way Sheets and Excel do, and in a form that
// inferCellInput reads back as the same value — so opening a cell and
// pressing Enter never turns a number into text or moves a date.
export function cellEditText(cell: EditableCell): string {
    const numFmt = cell.style?.numFmt
    switch (cell.kind) {
        case 'formula':
            return cell.formula ?? formatCell(cell.kind, cell.raw)
        case 'number':
            if (typeof cell.raw !== 'number') return formatCell(cell.kind, cell.raw)
            if (numFmt != null && isPercentFormat(numFmt)) return `${trimFloat(cell.raw * 100)}%`
            if (numFmt != null && isDateFormat(numFmt))
                return format(dateEditFormat(cell.raw), cell.raw)
            return trimFloat(cell.raw)
        case 'date': {
            const text = formatCell(cell.kind, cell.raw, undefined, DATE_TIME_EDIT_FORMAT)
            return text.endsWith(' 0:00:00') ? text.slice(0, -' 0:00:00'.length) : text
        }
        default:
            return formatCell(cell.kind, cell.raw)
    }
}

function dateEditFormat(serial: number): string {
    return Number.isInteger(serial) ? DATE_EDIT_FORMAT : DATE_TIME_EDIT_FORMAT
}

// Multiplying by 100 for percent display surfaces binary float noise
// (0.0146 * 100 = 1.4600000000000002); 15 significant digits is the
// precision spreadsheets keep.
function trimFloat(n: number): string {
    return String(Number(n.toPrecision(15)))
}
