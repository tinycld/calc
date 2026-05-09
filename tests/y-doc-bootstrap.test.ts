import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { cellKey, type WorkbookModel } from '../tinycld/sheets/lib/workbook-types'
import { yCellKey } from '../tinycld/sheets/lib/y-cell-key'
import {
    bootstrapYDocFromWorkbook,
    CELLS_MAP,
    SHEETS_MAP,
    ydocIsEmpty,
    ydocSheetIds,
} from '../tinycld/sheets/lib/y-doc-bootstrap'

function makeWorkbook(): WorkbookModel {
    return {
        sheets: [
            {
                name: 'Sheet1',
                rowCount: 3,
                colCount: 3,
                cells: {
                    [cellKey(1, 1)]: { raw: 'A1', display: 'A1' },
                    [cellKey(1, 2)]: { raw: 'B1', display: 'B1' },
                    [cellKey(2, 1)]: { raw: 'A2', display: 'A2' },
                },
            },
            {
                name: 'Numbers',
                rowCount: 2,
                colCount: 2,
                cells: {
                    [cellKey(1, 1)]: { raw: 42, display: '42' },
                },
            },
        ],
    }
}

describe('bootstrapYDocFromWorkbook', () => {
    it('marks an unbootstrapped doc as empty', () => {
        const doc = new Y.Doc()
        expect(ydocIsEmpty(doc)).toBe(true)
        expect(ydocSheetIds(doc)).toEqual([])
    })

    it('populates sheets with stable ids and metadata', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, makeWorkbook())

        expect(ydocIsEmpty(doc)).toBe(false)
        const ids = ydocSheetIds(doc)
        expect(ids).toEqual(['sheet1', 'sheet2'])

        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const sheet1 = sheetsMap.get('sheet1')
        const sheet2 = sheetsMap.get('sheet2')
        expect(sheet1?.get('name')).toBe('Sheet1')
        expect(sheet1?.get('position')).toBe(0)
        expect(sheet1?.get('rowCount')).toBe(3)
        expect(sheet1?.get('colCount')).toBe(3)
        expect(sheet2?.get('name')).toBe('Numbers')
        expect(sheet2?.get('position')).toBe(1)
    })

    it('populates cells under composite sheet:row:col keys', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, makeWorkbook())

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cellA1 = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(cellA1?.get('raw')).toBe('A1')
        expect(cellA1?.get('display')).toBe('A1')

        // Sheet 2 cell A1 — different sheet, separate key, parsed-numeric
        // value coerced to string per the no-coercion rule.
        const sheet2A1 = cellsMap.get(yCellKey('sheet2', 1, 1))
        expect(sheet2A1?.get('raw')).toBe('42')
        expect(sheet2A1?.get('display')).toBe('42')
    })

    it('runs in a single transaction', () => {
        const doc = new Y.Doc()
        let updateCount = 0
        doc.on('update', () => {
            updateCount++
        })
        bootstrapYDocFromWorkbook(doc, makeWorkbook())
        // The transaction should produce exactly one Yjs update
        // regardless of how many cells we wrote. This matters for sync:
        // bootstrapping a 100-cell workbook shouldn't fan out as 100
        // separate WS frames.
        expect(updateCount).toBe(1)
    })
})
