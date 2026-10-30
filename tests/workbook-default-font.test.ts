import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    DEFAULT_FONT_KEY,
    readWorkbookDefaultFont,
    WORKBOOK_MAP,
} from '../tinycld/calc/lib/workbook-default-font'

function docWithFont(fields: Record<string, unknown>): Y.Doc {
    const doc = new Y.Doc()
    const font = new Y.Map<unknown>()
    for (const [k, v] of Object.entries(fields)) font.set(k, v)
    doc.getMap(WORKBOOK_MAP).set(DEFAULT_FONT_KEY, font)
    return doc
}

describe('readWorkbookDefaultFont', () => {
    it('reads the name and size the server wrote', () => {
        const doc = docWithFont({ name: 'Arial', size: 10 })
        expect(readWorkbookDefaultFont(doc)).toEqual({ name: 'Arial', size: 10 })
    })

    it('reads a fractional size in the array form the Go bootstrap writes', () => {
        const doc = docWithFont({ name: 'Calibri', size: [10.5] })
        expect(readWorkbookDefaultFont(doc)).toEqual({ name: 'Calibri', size: 10.5 })
    })

    it('is empty when the workbook map has no default font', () => {
        expect(readWorkbookDefaultFont(new Y.Doc())).toEqual({})
    })

    it('drops an empty name and a non-positive or non-numeric size', () => {
        expect(readWorkbookDefaultFont(docWithFont({ name: '', size: 0 }))).toEqual({})
        expect(readWorkbookDefaultFont(docWithFont({ name: 'Calibri', size: '11' }))).toEqual({
            name: 'Calibri',
        })
    })
})
