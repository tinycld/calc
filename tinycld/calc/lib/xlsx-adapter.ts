import ExcelJS from 'exceljs'
import { type CellStyle, type CellValue, cellKey, type WorkbookModel, type WorksheetModel } from './workbook-types'

export {
    type CellStyle,
    type CellValue,
    cellKey,
    columnLabel,
    type WorkbookModel,
    type WorksheetModel,
} from './workbook-types'

export async function parseWorkbook(buffer: ArrayBuffer): Promise<WorkbookModel> {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)

    const sheets: WorksheetModel[] = wb.worksheets.map((ws) => {
        const cells: Record<string, CellValue> = {}
        let maxRow = 0
        let maxCol = 0

        ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                const value = cell.value
                let raw: CellValue['raw'] = null
                let display = ''
                let formula: string | undefined

                if (value === null || value === undefined) {
                    return
                }

                if (typeof value === 'object' && 'formula' in value) {
                    formula = value.formula
                    const result = value.result
                    if (result !== undefined && result !== null) {
                        if (typeof result === 'object' && 'error' in result) {
                            raw = null
                            display = String(result.error)
                        } else {
                            raw = result as CellValue['raw']
                            display = formatDisplay(result)
                        }
                    }
                } else if (value instanceof Date) {
                    raw = value
                    display = value.toISOString().slice(0, 10)
                } else if (typeof value === 'object' && 'richText' in value) {
                    const text = value.richText.map((r) => r.text).join('')
                    raw = text
                    display = text
                } else if (typeof value === 'object' && 'text' in value) {
                    raw = value.text
                    display = value.text
                } else if (typeof value === 'object' && 'error' in value) {
                    raw = null
                    display = String(value.error)
                } else {
                    raw = value as CellValue['raw']
                    display = formatDisplay(value)
                }

                const style = extractCellStyle(cell)
                cells[cellKey(rowNumber, colNumber)] = { raw, display, formula, style }
                if (rowNumber > maxRow) maxRow = rowNumber
                if (colNumber > maxCol) maxCol = colNumber
            })
        })

        const rowCount = Math.max(maxRow, ws.rowCount, 1)
        const colCount = Math.max(maxCol, ws.columnCount, 1)
        return { name: ws.name, rowCount, colCount, cells }
    })

    return { sheets }
}

export async function emptyWorkbookBuffer(sheetName = 'Sheet1'): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet(sheetName)
    const buf = await wb.xlsx.writeBuffer()
    return buf as ArrayBuffer
}

// extractCellStyle reads the subset of ExcelJS's cell.style that we
// currently track. Adding a new attribute here means: add the field to
// CellStyle (workbook-types.ts) AND the matching CellStyle field on
// the Go side (server/snapshot.go) so the snapshot consumer can decode
// it. Today only font.bold is wired through; the rest of the shape is
// in place so additions land additively.
function extractCellStyle(cell: ExcelJS.Cell): CellStyle | undefined {
    const out: CellStyle = {}
    let any = false
    if (cell.font?.bold) {
        out.font = { ...(out.font ?? {}), bold: true }
        any = true
    }
    return any ? out : undefined
}

function formatDisplay(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return String(value)
        return Number.isInteger(value) ? String(value) : value.toString()
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    return String(value)
}
