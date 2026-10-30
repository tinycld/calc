// Read a source-cell snapshot into a SourceTable. Pure function:
// takes a plain Map keyed by yCellKey(sheetId, row, col), a
// sheet-name -> sheet-id lookup, and the A1 source range; returns
// either a populated SourceTable or a typed error.

import type { CellValue } from '../workbook-types'
import { yCellKey } from '../y-cell-key'
import { parseA1Range } from './range-parse'
import { ok, pivotError, type Result, type SourceTable } from './types'

const EMPTY_CELL: CellValue = { kind: 'string', raw: null, display: '' }

export function readSourceTable(
    a1: string,
    cells: ReadonlyMap<string, CellValue>,
    sheetIdByName: Readonly<Record<string, string>>
): Result<SourceTable> {
    const parsed = parseA1Range(a1)
    if (!parsed.ok) {
        return pivotError('malformed-range', `Source range "${a1}" is not a valid A1 range.`)
    }
    const sheetId = sheetIdByName[parsed.sheetName]
    if (sheetId == null) {
        return pivotError(
            'missing-source-sheet',
            `Source sheet "${parsed.sheetName}" was not found.`
        )
    }

    const rawHeaders: string[] = []
    for (let c = parsed.startCol; c <= parsed.endCol; c++) {
        const cell = cells.get(yCellKey(sheetId, parsed.startRow, c))
        rawHeaders.push(cell != null ? String(cell.raw ?? cell.display ?? '') : '')
    }
    const headers = uniqueFieldNames(rawHeaders)

    const rows: Record<string, CellValue>[] = []
    for (let r = parsed.startRow + 1; r <= parsed.endRow; r++) {
        const row: Record<string, CellValue> = {}
        for (let i = 0; i < headers.length; i++) {
            const c = parsed.startCol + i
            const cell = cells.get(yCellKey(sheetId, r, c))
            row[headers[i]] = cell ?? EMPTY_CELL
        }
        rows.push(row)
    }
    if (rows.length === 0) {
        return pivotError(
            'zero-data-rows',
            `Source range ${a1} has no data rows (header row only).`
        )
    }

    return ok({ headers, rows })
}

// Excel and Google Sheets accept a repeated header and give each later
// copy a numeric suffix in the pivot cache (" ", " 2", " 3", …). Imported
// pivots reference fields by those cache names, so naming them the same
// way here lets every field resolve.
function uniqueFieldNames(headers: readonly string[]): string[] {
    const taken = new Set(headers)
    const seen = new Set<string>()
    return headers.map(header => {
        if (!seen.has(header)) {
            seen.add(header)
            return header
        }
        let n = 2
        while (taken.has(`${header}${n}`)) n++
        const name = `${header}${n}`
        taken.add(name)
        seen.add(name)
        return name
    })
}
