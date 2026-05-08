export interface CellValue {
    raw: string | number | boolean | Date | null
    display: string
    formula?: string
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
