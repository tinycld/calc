import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { bootstrapYDocFromWorkbook } from '../tinycld/calc/lib/y-doc-bootstrap'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { snapshotForPrint } from '../tinycld/calc/lib/print/snapshot'

function buildDoc(model: WorkbookModel): Y.Doc {
    const doc = new Y.Doc()
    bootstrapYDocFromWorkbook(doc, model)
    return doc
}

const SAMPLE: WorkbookModel = {
    sheets: [
        {
            name: 'Alpha',
            rowCount: 3,
            colCount: 3,
            cells: {
                '1:1': { kind: 'string', raw: 'A1', display: 'A1' },
                '1:2': { kind: 'string', raw: 'B1', display: 'B1' },
                '2:1': { kind: 'number', raw: 42, display: '42' },
            },
        },
        {
            name: 'Beta',
            rowCount: 2,
            colCount: 2,
            cells: {
                '1:1': { kind: 'string', raw: 'beta', display: 'beta' },
            },
        },
    ],
}

describe('snapshotForPrint', () => {
    it('returns the current sheet only when scope.sheets is "current"', () => {
        const doc = buildDoc(SAMPLE)
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'current',
            currentSheetId: 'sheet2',
            range: 'used',
            currentSelection: null,
        })
        expect(snap.sheets.length).toBe(1)
        expect(snap.sheets[0].name).toBe('Beta')
    })

    it('returns all sheets when scope.sheets is "all"', () => {
        const doc = buildDoc(SAMPLE)
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'all',
            currentSheetId: 'sheet1',
            range: 'used',
            currentSelection: null,
        })
        expect(snap.sheets.map(s => s.name)).toEqual(['Alpha', 'Beta'])
    })

    it('returns only picked sheets when scope.sheets is an id set', () => {
        const doc = buildDoc(SAMPLE)
        const snap = snapshotForPrint(doc, {
            sheetsScope: { ids: ['sheet2'] },
            currentSheetId: 'sheet1',
            range: 'used',
            currentSelection: null,
        })
        expect(snap.sheets.length).toBe(1)
        expect(snap.sheets[0].name).toBe('Beta')
    })

    it('trims trailing empty rows and columns for used-range scope', () => {
        const doc = buildDoc({
            sheets: [
                {
                    name: 'Used',
                    rowCount: 100,
                    colCount: 100,
                    cells: {
                        '1:1': { kind: 'string', raw: 'x', display: 'x' },
                        '2:3': { kind: 'string', raw: 'y', display: 'y' },
                    },
                },
            ],
        })
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'current',
            currentSheetId: 'sheet1',
            range: 'used',
            currentSelection: null,
        })
        const s = snap.sheets[0]
        expect(s.rowOffset).toBe(1)
        expect(s.colOffset).toBe(1)
        expect(s.rowCount).toBe(2)
        expect(s.colCount).toBe(3)
    })

    it('uses currentSelection rectangle when range is "selection"', () => {
        const doc = buildDoc(SAMPLE)
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'current',
            currentSheetId: 'sheet1',
            range: 'selection',
            currentSelection: {
                sheetId: 'sheet1',
                rect: { startRow: 2, startCol: 1, endRow: 2, endCol: 2 },
            },
        })
        const s = snap.sheets[0]
        expect(s.rowOffset).toBe(2)
        expect(s.colOffset).toBe(1)
        expect(s.rowCount).toBe(1)
        expect(s.colCount).toBe(2)
    })

    it('falls back to used range when selection scope chosen but selection is null', () => {
        const doc = buildDoc(SAMPLE)
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'current',
            currentSheetId: 'sheet1',
            range: 'selection',
            currentSelection: null,
        })
        const s = snap.sheets[0]
        expect(s.rowCount).toBeGreaterThanOrEqual(1)
        expect(s.colCount).toBeGreaterThanOrEqual(1)
    })

    it('falls back to used range when selection scope chosen but selection is on a different sheet', () => {
        const doc = buildDoc(SAMPLE)
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'all',
            currentSheetId: 'sheet1',
            range: 'selection',
            currentSelection: {
                sheetId: 'sheet1',
                rect: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
            },
        })
        // sheet2 should fall back to its own used range, not be empty
        const beta = snap.sheets.find(s => s.name === 'Beta')
        expect(beta).toBeDefined()
        expect(beta?.rowCount).toBeGreaterThanOrEqual(1)
    })

    it('emits an empty sheet when there are zero cells', () => {
        const doc = buildDoc({
            sheets: [{ name: 'Empty', rowCount: 0, colCount: 0, cells: {} }],
        })
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'current',
            currentSheetId: 'sheet1',
            range: 'used',
            currentSelection: null,
        })
        expect(snap.sheets[0].rowCount).toBe(0)
        expect(snap.sheets[0].colCount).toBe(0)
        expect(snap.sheets[0].cells.size).toBe(0)
    })

    it('preserves cell display and style', () => {
        const doc = buildDoc({
            sheets: [
                {
                    name: 'Styled',
                    rowCount: 1,
                    colCount: 1,
                    cells: {
                        '1:1': {
                            kind: 'string',
                            raw: 'x',
                            display: 'X',
                            style: { font: { bold: true } },
                        },
                    },
                },
            ],
        })
        const snap = snapshotForPrint(doc, {
            sheetsScope: 'current',
            currentSheetId: 'sheet1',
            range: 'used',
            currentSelection: null,
        })
        const cell = snap.sheets[0].cells.get('1:1')
        expect(cell?.display).toBe('X')
        expect(cell?.style?.font?.bold).toBe(true)
    })
})
