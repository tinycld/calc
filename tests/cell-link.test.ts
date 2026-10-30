import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    clearYCellContent,
    setYCell,
    setYCellLink,
    setYCellStyle,
} from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readYCell } from '../tinycld/calc/lib/y-doc-bootstrap'

function read(doc: Y.Doc, row: number, col: number) {
    const cell = doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', row, col))
    return cell == null ? null : readYCell(cell)
}

describe('cell links', () => {
    it('adds a link to a cell and keeps its value', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'Docs')
        setYCellLink(doc, 'sheet1', 1, 1, 'https://example.com')
        expect(read(doc, 1, 1)?.link).toBe('https://example.com')
        expect(read(doc, 1, 1)?.raw).toBe('Docs')
    })

    it('a link on an empty cell shows the URL as its text', () => {
        const doc = new Y.Doc()
        setYCellLink(doc, 'sheet1', 2, 2, 'https://example.com')
        expect(read(doc, 2, 2)?.raw).toBe('https://example.com')
        expect(read(doc, 2, 2)?.kind).toBe('string')
    })

    it('removing a link keeps the value', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'Docs')
        setYCellLink(doc, 'sheet1', 1, 1, 'https://example.com')
        setYCellLink(doc, 'sheet1', 1, 1, null)
        expect(read(doc, 1, 1)?.link).toBeUndefined()
        expect(read(doc, 1, 1)?.raw).toBe('Docs')
    })

    it('clearing the content of a styled cell removes its link too', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'Docs')
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCellLink(doc, 'sheet1', 1, 1, 'https://example.com')
        clearYCellContent(doc, 'sheet1', 1, 1)
        expect(read(doc, 1, 1)?.link).toBeUndefined()
    })
})
