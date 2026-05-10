import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { setYRowHeight } from '../tinycld/calc/lib/dimensions'
import {
    applyFilter,
    clearFilter,
    distinctValuesForColumn,
    readFilterView,
} from '../tinycld/calc/lib/filter'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function seedSheet(doc: Y.Doc, sheetId: string): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', sheetId)
    meta.set('position', 0)
    meta.set('rowCount', 100)
    meta.set('colCount', 10)
    sheetsMap.set(sheetId, meta)
}

function readRowHeight(doc: Y.Doc, sheetId: string, row: number): number | undefined {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    const heights = meta?.get('rowHeights')
    if (!(heights instanceof Y.Map)) return undefined
    const v = heights.get(String(row))
    return typeof v === 'number' ? v : undefined
}

describe('applyFilter', () => {
    it('hides rows that do not match a values criterion', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')
        setYCell(doc, 'sheet1', 4, 1, 'Cherry')

        applyFilter(doc, 'sheet1', {
            range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            criteria: { 1: { type: 'values', allowedValues: ['Apple', 'Cherry'] } },
        })

        // Header always visible (no override).
        expect(readRowHeight(doc, 'sheet1', 1)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        // Banana hidden.
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
    })

    it('hides rows that fail a "gt" condition', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Score')
        setYCell(doc, 'sheet1', 2, 1, '50')
        setYCell(doc, 'sheet1', 3, 1, '20')
        setYCell(doc, 'sheet1', 4, 1, '90')

        applyFilter(doc, 'sheet1', {
            range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            criteria: { 1: { type: 'condition', condition: { op: 'gt', value: '40' } } },
        })

        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBeUndefined()
    })

    it('contains and isEmpty conditions work', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Name')
        setYCell(doc, 'sheet1', 2, 1, 'Alice')
        setYCell(doc, 'sheet1', 3, 1, 'Albert')
        setYCell(doc, 'sheet1', 4, 1, 'Bob')

        applyFilter(doc, 'sheet1', {
            range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            criteria: { 1: { type: 'condition', condition: { op: 'contains', value: 'Al' } } },
        })
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 4)).toBe(0)

        clearFilter(doc, 'sheet1')

        // isEmpty: hide non-empty.
        applyFilter(doc, 'sheet1', {
            range: { startRow: 1, endRow: 4, startCol: 1, endCol: 1 },
            criteria: { 1: { type: 'condition', condition: { op: 'isEmpty' } } },
        })
        expect(readRowHeight(doc, 'sheet1', 2)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBe(0)
    })

    it('AND-combines multiple-column criteria', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Name')
        setYCell(doc, 'sheet1', 1, 2, 'Score')
        setYCell(doc, 'sheet1', 2, 1, 'Alice')
        setYCell(doc, 'sheet1', 2, 2, '90')
        setYCell(doc, 'sheet1', 3, 1, 'Alice')
        setYCell(doc, 'sheet1', 3, 2, '20')
        setYCell(doc, 'sheet1', 4, 1, 'Bob')
        setYCell(doc, 'sheet1', 4, 2, '90')

        applyFilter(doc, 'sheet1', {
            range: { startRow: 1, endRow: 4, startCol: 1, endCol: 2 },
            criteria: {
                1: { type: 'values', allowedValues: ['Alice'] },
                2: { type: 'condition', condition: { op: 'gt', value: '50' } },
            },
        })

        // Only row 2 passes both (Alice with score 90).
        expect(readRowHeight(doc, 'sheet1', 2)).toBeUndefined()
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)
        expect(readRowHeight(doc, 'sheet1', 4)).toBe(0)
    })

    it('clearFilter restores rows including custom heights via savedHeights', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')

        // User set row 3 to a custom height before filtering.
        setYRowHeight(doc, 'sheet1', 3, 60)
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(60)

        applyFilter(doc, 'sheet1', {
            range: { startRow: 1, endRow: 3, startCol: 1, endCol: 1 },
            criteria: { 1: { type: 'values', allowedValues: ['Apple'] } },
        })
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(0)

        const view = readFilterView(doc, 'sheet1')
        expect(view).not.toBeNull()
        expect(view?.savedHeights[3]).toBe(60)

        clearFilter(doc, 'sheet1')
        expect(readRowHeight(doc, 'sheet1', 3)).toBe(60)
        expect(readFilterView(doc, 'sheet1')).toBeNull()
    })

    it('distinctValuesForColumn returns sorted unique displays excluding header', () => {
        const doc = new Y.Doc()
        seedSheet(doc, 'sheet1')
        setYCell(doc, 'sheet1', 1, 1, 'Fruit')
        setYCell(doc, 'sheet1', 2, 1, 'Apple')
        setYCell(doc, 'sheet1', 3, 1, 'Banana')
        setYCell(doc, 'sheet1', 4, 1, 'Apple')
        setYCell(doc, 'sheet1', 5, 1, 'Cherry')

        const distinct = distinctValuesForColumn(
            doc,
            'sheet1',
            { startRow: 1, endRow: 5, startCol: 1, endCol: 1 },
            1
        )
        expect(distinct).toEqual(['Apple', 'Banana', 'Cherry'])
    })
})
