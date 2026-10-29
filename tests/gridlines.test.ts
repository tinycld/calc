import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setGridLinesVisible } from '../tinycld/calc/hooks/use-y-sheets'
import { HIDE_GRID_LINES_KEY, SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function seed(): { doc: Y.Doc; meta: Y.Map<unknown> } {
    const doc = new Y.Doc()
    const meta = new Y.Map<unknown>()
    meta.set('name', 'Sheet1')
    doc.getMap<Y.Map<unknown>>(SHEETS_MAP).set('sheet1', meta)
    return { doc, meta }
}

describe('setGridLinesVisible', () => {
    it('hiding writes hideGridLines: true and showing deletes the key', () => {
        const { doc, meta } = seed()
        setGridLinesVisible(doc, 'sheet1', false)
        expect(meta.get(HIDE_GRID_LINES_KEY)).toBe(true)
        setGridLinesVisible(doc, 'sheet1', true)
        expect(meta.has(HIDE_GRID_LINES_KEY)).toBe(false)
    })

    it('is one undo step', () => {
        const { doc, meta } = seed()
        const undo = new Y.UndoManager([doc.getMap(SHEETS_MAP)], {
            trackedOrigins: new Set([LOCAL_ORIGIN]),
        })
        setGridLinesVisible(doc, 'sheet1', false)
        undo.undo()
        expect(meta.has(HIDE_GRID_LINES_KEY)).toBe(false)
    })

    it('ignores an unknown sheet', () => {
        const { doc } = seed()
        setGridLinesVisible(doc, 'missing', false)
        expect(doc.getMap(SHEETS_MAP).has('missing')).toBe(false)
    })
})
