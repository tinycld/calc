import { describe, expect, it } from 'vitest'
import { readSourceTable } from '../tinycld/calc/lib/pivot/source-read'
import type { CellValue } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'

function str(value: string): CellValue {
    return { kind: 'string', raw: value, display: value }
}
function num(value: number): CellValue {
    return { kind: 'number', raw: value, display: String(value) }
}

function makeCells(sheetId: string, rows: CellValue[][]): Map<string, CellValue> {
    const m = new Map<string, CellValue>()
    rows.forEach((row, r) => {
        row.forEach((cell, c) => {
            m.set(yCellKey(sheetId, r + 1, c + 1), cell)
        })
    })
    return m
}

describe('readSourceTable', () => {
    it('reads a simple rectangle into headers + rows', () => {
        const cells = makeCells('s1', [
            [str('Region'), str('Year'), str('Sales')],
            [str('East'), num(2024), num(100)],
            [str('West'), num(2024), num(200)],
        ])
        const r = readSourceTable('Sheet1!A1:C3', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value.headers).toEqual(['Region', 'Year', 'Sales'])
        expect(r.value.rows).toHaveLength(2)
        expect(r.value.rows[0].Region.raw).toBe('East')
        expect(r.value.rows[1].Sales.raw).toBe(200)
    })

    it('errors when sheet name does not resolve', () => {
        const cells = new Map<string, CellValue>()
        const r = readSourceTable('Missing!A1:B2', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.code).toBe('missing-source-sheet')
    })

    it('errors on malformed range', () => {
        const cells = new Map<string, CellValue>()
        const r = readSourceTable('not a range', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.code).toBe('malformed-range')
    })

    it('names repeated headers the way the xlsx pivot cache does', () => {
        // Google/Excel exports name the 2nd, 3rd, … copy of a header by
        // appending 2, 3, … (a run of " " headers caches as " ", " 2", " 3").
        const cells = makeCells('s1', [
            [str('Region'), str(' '), str(' '), str(' ')],
            [str('East'), str('a'), str('b'), str('c')],
        ])
        const r = readSourceTable('Sheet1!A1:D2', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value.headers).toEqual(['Region', ' ', ' 2', ' 3'])
        expect(r.value.rows[0][' '].raw).toBe('a')
        expect(r.value.rows[0][' 2'].raw).toBe('b')
        expect(r.value.rows[0][' 3'].raw).toBe('c')
    })

    it('skips a suffix that another header already uses', () => {
        const cells = makeCells('s1', [
            [str('A'), str('A2'), str('A')],
            [str('x'), str('y'), str('z')],
        ])
        const r = readSourceTable('Sheet1!A1:C2', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value.headers).toEqual(['A', 'A2', 'A3'])
        expect(r.value.rows[0].A3.raw).toBe('z')
    })

    it('keeps every blank-header column as its own field', () => {
        const cells = makeCells('s1', [
            [str(''), str('Sales'), str('')],
            [str('x'), num(1), str('z')],
        ])
        const r = readSourceTable('Sheet1!A1:C2', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value.headers).toEqual(['', 'Sales', '2'])
        expect(r.value.rows[0]['2'].raw).toBe('z')
    })

    it('errors on zero data rows (range is one row tall)', () => {
        const cells = makeCells('s1', [[str('Region'), str('Year')]])
        const r = readSourceTable('Sheet1!A1:B1', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.code).toBe('zero-data-rows')
    })

    it('synthesizes empty CellValue for missing source cells', () => {
        const cells = makeCells('s1', [
            [str('Region'), str('Sales')],
            [str('East')], // missing column B
        ])
        const r = readSourceTable('Sheet1!A1:B2', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value.rows[0].Sales.raw).toBeNull()
        expect(r.value.rows[0].Sales.display).toBe('')
    })

    it('synthesizes empty header for missing header cells', () => {
        // A1 missing → header is empty string.
        const cells = new Map<string, CellValue>()
        cells.set(yCellKey('s1', 1, 2), str('Sales'))
        cells.set(yCellKey('s1', 2, 1), str('East'))
        cells.set(yCellKey('s1', 2, 2), num(1))
        const r = readSourceTable('Sheet1!A1:B2', cells, { Sheet1: 's1' })
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.value.headers).toEqual(['', 'Sales'])
    })
})
