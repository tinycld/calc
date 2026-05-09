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

export interface CellValue {
    raw: string | number | boolean | Date | null
    display: string
    formula?: string
    style?: CellStyle
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
