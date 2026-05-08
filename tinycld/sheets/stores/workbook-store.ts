import { create } from '@tinycld/core/lib/store'
import { type CellValue, cellKey, type WorkbookModel, type WorksheetModel } from '../lib/workbook-types'

interface WorkbookStoreState {
    workbooks: Record<string, WorkbookModel>
    setWorkbook: (id: string, model: WorkbookModel) => void
    setCell: (id: string, sheetIndex: number, row: number, col: number, input: string) => void
    discardWorkbook: (id: string) => void
}

export const useWorkbookStore = create<WorkbookStoreState>()((set) => ({
    workbooks: {},

    setWorkbook: (id, model) => set((s) => ({ workbooks: { ...s.workbooks, [id]: model } })),

    setCell: (id, sheetIndex, row, col, input) =>
        set((s) => {
            const workbook = s.workbooks[id]
            if (!workbook) return s
            const sheet = workbook.sheets[sheetIndex]
            if (!sheet) return s

            const key = cellKey(row, col)
            const cells = input === '' ? omitKey(sheet.cells, key) : { ...sheet.cells, [key]: makeCellFromInput(input) }
            if (cells === sheet.cells) return s

            const nextSheet: WorksheetModel = {
                ...sheet,
                rowCount: Math.max(sheet.rowCount, row),
                colCount: Math.max(sheet.colCount, col),
                cells,
            }
            const sheets = workbook.sheets.map((ws, i) => (i === sheetIndex ? nextSheet : ws))
            return {
                workbooks: {
                    ...s.workbooks,
                    [id]: { ...workbook, sheets },
                },
            }
        }),

    discardWorkbook: (id) =>
        set((s) => {
            if (!(id in s.workbooks)) return s
            const next = { ...s.workbooks }
            delete next[id]
            return { workbooks: next }
        }),
}))

function makeCellFromInput(input: string): CellValue {
    return { raw: input, display: input }
}

function omitKey<V>(obj: Record<string, V>, key: string): Record<string, V> {
    if (!(key in obj)) return obj
    const next = { ...obj }
    delete next[key]
    return next
}
