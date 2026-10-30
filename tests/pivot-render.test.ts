import { describe, expect, it } from 'vitest'
import { aggregate } from '../tinycld/calc/lib/pivot/aggregate'
import { renderPivot } from '../tinycld/calc/lib/pivot/render'
import type { SourceTable } from '../tinycld/calc/lib/pivot/types'
import type { CellValue, PivotDefinition } from '../tinycld/calc/lib/workbook-types'

function str(s: string): CellValue {
    return { kind: 'string', raw: s, display: s }
}
function num(n: number): CellValue {
    return { kind: 'number', raw: n, display: String(n) }
}
function table(headers: string[], rows: CellValue[][]): SourceTable {
    return {
        headers,
        rows: rows.map(r => {
            const o: Record<string, CellValue> = {}
            headers.forEach((h, i) => {
                o[h] = r[i]
            })
            return o
        }),
    }
}
function baseDef(overrides: Partial<PivotDefinition>): PivotDefinition {
    return {
        id: 'p',
        sourceRange: 'X!A1:A1',
        targetSheetName: 'P',
        rows: [],
        cols: [],
        values: [],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
        ...overrides,
    }
}
function pick(cells: Map<string, CellValue>, r: number, c: number) {
    return cells.get(`${r}:${c}`)
}

describe('renderPivot — minimal layout', () => {
    it('renders rows x cols x one value with grand totals', () => {
        const t = table(
            ['Region', 'Year', 'Sales'],
            [
                [str('East'), num(2024), num(10)],
                [str('East'), num(2025), num(20)],
                [str('West'), num(2024), num(5)],
            ]
        )
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            cols: [{ sourceColumn: 'Year' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Layout for this case (Google Sheets / Excel tabular form):
        //   row 1: [ "Sum of Sales", "Year", "", "" ]
        //   row 2: [ "Region", 2024, 2025, "Grand Total" ]
        //   row 3: [ "East", 10, 20, 30 ]
        //   row 4: [ "West", 5, "", 5 ]
        //   row 5: [ "Grand Total", 15, 20, 35 ]
        expect(out.rows).toBe(5)
        expect(out.cols).toBe(4)
        expect(out.headerRowCount).toBe(2)
        expect(out.headerColCount).toBe(1)
        expect(pick(out.cells, 1, 1)!.display).toBe('Sum of Sales')
        expect(pick(out.cells, 1, 2)!.display).toBe('Year')
        expect(pick(out.cells, 2, 1)!.display).toBe('Region')
        expect(pick(out.cells, 2, 2)!.display).toBe('2024')
        expect(pick(out.cells, 2, 4)!.display).toBe('Grand Total')
        expect(pick(out.cells, 3, 1)!.display).toBe('East')
        expect(pick(out.cells, 3, 2)!.raw).toBe(10)
        expect(pick(out.cells, 3, 4)!.raw).toBe(30)
        expect(pick(out.cells, 4, 3)!.display).toBe('')
        expect(pick(out.cells, 5, 1)!.display).toBe('Grand Total')
        expect(pick(out.cells, 5, 4)!.raw).toBe(35)
        expect(out.grandTotalRow).toBe(5)
    })

    it('omits grand-total row/col when disabled', () => {
        const t = table(['Region', 'Sales'], [[str('East'), num(10)]])
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Layout: row 1 = [ "", "Sum of Sales" ]; row 2 = [ "East", 10 ]
        expect(out.rows).toBe(2)
        expect(out.cols).toBe(2)
    })

    it('uses two header rows when multiple value fields exist', () => {
        const t = table(
            ['Region', 'Year', 'Sales', 'Cost'],
            [
                [str('East'), num(2024), num(10), num(3)],
                [str('East'), num(2025), num(20), num(7)],
            ]
        )
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            cols: [{ sourceColumn: 'Year' }],
            values: [
                { sourceColumn: 'Sales', aggregation: 'sum' },
                { sourceColumn: 'Cost', aggregation: 'sum' },
            ],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Three header rows: row 1 = col-field captions; row 2 = col
        // items; row 3 = row-field captions + per-cell value labels.
        expect(out.headerRowCount).toBe(3)
        expect(pick(out.cells, 1, 2)!.display).toBe('Year')
        expect(pick(out.cells, 2, 2)!.display).toBe('2024')
        expect(pick(out.cells, 2, 4)!.display).toBe('2025')
        expect(pick(out.cells, 3, 1)!.display).toBe('Region')
        expect(pick(out.cells, 3, 2)!.display).toBe('Sum of Sales')
        expect(pick(out.cells, 3, 3)!.display).toBe('Sum of Cost')
        expect(pick(out.cells, 4, 2)!.raw).toBe(10)
    })

    it('applies per-value numFmt to data cells', () => {
        const t = table(['Region', 'Sales'], [[str('East'), num(1500)]])
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum', numFmt: '#,##0' }],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // The data cell at (row 2, col 2) is 1500 formatted with #,##0.
        expect(pick(out.cells, 2, 2)!.display).toBe('1,500')
    })

    it('renders no-rows/no-cols pivot as 2x2 with one data cell', () => {
        const t = table(['Sales'], [[num(10)], [num(20)]])
        const def = baseDef({
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            rowGrandTotals: false,
            colGrandTotals: false,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // Layout: row 1 = [ "Sum of Sales" ]; row 2 = [ 30 ]
        expect(out.rows).toBe(2)
        expect(out.cols).toBe(1)
        expect(pick(out.cells, 1, 1)!.display).toBe('Sum of Sales')
        expect(pick(out.cells, 2, 1)!.raw).toBe(30)
    })

    it('emits subtotal rows when rowSubtotals=true and multiple row fields', () => {
        const t = table(
            ['Region', 'Country', 'Sales'],
            [
                [str('East'), str('US'), num(10)],
                [str('East'), str('CA'), num(20)],
                [str('West'), str('US'), num(5)],
            ]
        )
        const def = baseDef({
            rows: [{ sourceColumn: 'Region' }, { sourceColumn: 'Country' }],
            values: [{ sourceColumn: 'Sales', aggregation: 'sum' }],
            rowGrandTotals: false,
            colGrandTotals: false,
            rowSubtotals: true,
        })
        const tree = aggregate(t, def)
        const out = renderPivot(tree, def)
        // We expect subtotal rows "East Total" (30) and "West Total" (5)
        // after each Region group.
        const labels: string[] = []
        for (let r = 1; r <= out.rows; r++) {
            labels.push(pick(out.cells, r, 1)?.display ?? '')
        }
        expect(labels).toContain('East Total')
        expect(labels).toContain('West Total')
    })
})

function displayRow(out: ReturnType<typeof renderPivot>, r: number): string[] {
    const row: string[] = []
    for (let c = 1; c <= out.cols; c++) row.push(pick(out.cells, r, c)?.display ?? '')
    return row
}

describe('renderPivot — Google Sheets import parity', () => {
    // Shaped after workers-comp.xlsx: a text code column, a text name
    // column and a currency total.
    const source = table(
        ['Code', 'Employee', 'Total'],
        [
            [str('Sales'), str('Ann'), num(100)],
            [str('Clerical'), str('Bob'), num(50.5)],
            [str('Sales'), str('Bob'), num(0)],
            [str('Clerical'), str('Ann'), num(25)],
            [str('Asbestos'), str('Cy'), num(10)],
        ]
    )
    const money = '"$"#,##0.00'

    it('uses a value displayName verbatim as its caption', () => {
        const def = baseDef({
            rows: [{ sourceColumn: 'Code' }],
            values: [{ sourceColumn: 'Total', aggregation: 'sum', displayName: 'SUM of Total' }],
        })
        const out = renderPivot(aggregate(source, def), def)
        expect(displayRow(out, 1)).toEqual(['Code', 'SUM of Total'])
    })

    it('gives one column per value and no grand-total column when there are no column fields', () => {
        const def = baseDef({
            rows: [{ sourceColumn: 'Code' }],
            values: [
                { sourceColumn: 'Code', aggregation: 'sum', displayName: 'SUM of Code' },
                { sourceColumn: 'Employee', aggregation: 'sum', displayName: 'SUM of Employee' },
                {
                    sourceColumn: 'Total',
                    aggregation: 'sum',
                    displayName: 'SUM of Total',
                    numFmt: money,
                },
            ],
        })
        const out = renderPivot(aggregate(source, def), def)
        expect(out.cols).toBe(4)
        expect(out.headerRowCount).toBe(1)
        expect(displayRow(out, 1)).toEqual([
            'Code',
            'SUM of Code',
            'SUM of Employee',
            'SUM of Total',
        ])
        expect(displayRow(out, 2)).toEqual(['Asbestos', '0', '0', '$10.00'])
        expect(displayRow(out, 3)).toEqual(['Clerical', '0', '0', '$75.50'])
        expect(displayRow(out, 4)).toEqual(['Sales', '0', '0', '$100.00'])
        expect(displayRow(out, 5)).toEqual(['Grand Total', '0', '0', '$185.50'])
        expect(out.rows).toBe(5)
        expect(out.grandTotalRow).toBe(5)
    })

    it('lays out row x column fields with captions, blanks for empty combos and 0 for zero sums', () => {
        const def = baseDef({
            rows: [{ sourceColumn: 'Employee' }],
            cols: [{ sourceColumn: 'Code' }],
            values: [
                {
                    sourceColumn: 'Total',
                    aggregation: 'sum',
                    displayName: 'SUM of Total',
                    numFmt: money,
                },
            ],
        })
        const out = renderPivot(aggregate(source, def), def)
        expect(out.headerRowCount).toBe(2)
        expect(displayRow(out, 1)).toEqual(['SUM of Total', 'Code', '', '', ''])
        expect(displayRow(out, 2)).toEqual([
            'Employee',
            'Asbestos',
            'Clerical',
            'Sales',
            'Grand Total',
        ])
        expect(displayRow(out, 3)).toEqual(['Ann', '', '$25.00', '$100.00', '$125.00'])
        expect(displayRow(out, 4)).toEqual(['Bob', '', '$50.50', '$0.00', '$50.50'])
        expect(displayRow(out, 5)).toEqual(['Cy', '$10.00', '', '', '$10.00'])
        expect(displayRow(out, 6)).toEqual([
            'Grand Total',
            '$10.00',
            '$75.50',
            '$100.00',
            '$185.50',
        ])
    })

    it('marks the field captions and the grand-total row for styling', () => {
        const def = baseDef({
            rows: [{ sourceColumn: 'Employee' }],
            cols: [{ sourceColumn: 'Code' }],
            values: [{ sourceColumn: 'Total', aggregation: 'sum' }],
        })
        const out = renderPivot(aggregate(source, def), def)
        expect(Array.from(out.fieldLabelCells).sort()).toEqual(['1:2', '2:1'])
        expect(out.grandTotalRow).toBe(6)
    })

    it('omits the grand-total row when there are no row fields', () => {
        const def = baseDef({
            cols: [{ sourceColumn: 'Code' }],
            values: [{ sourceColumn: 'Total', aggregation: 'sum' }],
        })
        const out = renderPivot(aggregate(source, def), def)
        // Header rows (caption + items) and the single data row.
        expect(out.rows).toBe(3)
        expect(out.grandTotalRow).toBeNull()
        expect(displayRow(out, 2)).toEqual(['Asbestos', 'Clerical', 'Sales', 'Grand Total'])
        expect(displayRow(out, 3)).toEqual(['10', '75.5', '100', '185.5'])
    })
})
