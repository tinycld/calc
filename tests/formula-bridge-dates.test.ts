import { HyperFormula } from 'hyperformula'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { FormulaBridge } from '../tinycld/calc/lib/formula/bridge'
import { HYPERFORMULA_CONFIG } from '../tinycld/calc/lib/formula/hyperformula-config'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import {
    bootstrapYDocFromWorkbook,
    CELLS_MAP,
    readYCell,
} from '../tinycld/calc/lib/y-doc-bootstrap'

// Dates are stored as ISO strings in the doc. The bridge must hand them
// to HyperFormula as dates (so date math works), keep text cells as
// text (so "12/6/24" typed as text is not re-read as a date), and give
// a date result a date format when the cell has none.

function workbook(): WorkbookModel {
    return {
        sheets: [
            {
                name: 'Sheet1',
                rowCount: 5,
                colCount: 5,
                cells: {
                    '1:1': { kind: 'date', raw: '2024-12-06', display: '2024-12-06' },
                    '1:2': { kind: 'string', raw: '12/6/24', display: '12/6/24' },
                    '1:3': { kind: 'string', raw: '=not a formula', display: '=not a formula' },
                },
            },
        ],
    }
}

function startBridge(doc: Y.Doc): FormulaBridge {
    const bridge = new FormulaBridge(doc, HyperFormula.buildEmpty(HYPERFORMULA_CONFIG))
    bridge.start()
    return bridge
}

function cell(doc: Y.Doc, row: number, col: number) {
    const c = doc.getMap<Y.Map<unknown>>(CELLS_MAP).get(yCellKey('sheet1', row, col))
    return c == null ? null : readYCell(c)
}

describe('FormulaBridge dates', () => {
    it('does date math on an imported ISO date', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, workbook())
        const bridge = startBridge(doc)
        try {
            setYCell(doc, 'sheet1', 2, 1, '=A1+1')
            expect(cell(doc, 2, 1)?.raw).toBe(45633)
        } finally {
            bridge.stop()
        }
    })

    it('gives a date result a date format when the cell has none', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, workbook())
        const bridge = startBridge(doc)
        try {
            setYCell(doc, 'sheet1', 2, 1, '=A1+1')
            expect(cell(doc, 2, 1)?.style?.numFmt).toBe('m/d/yyyy')
        } finally {
            bridge.stop()
        }
    })

    it('keeps a number result unformatted', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, workbook())
        const bridge = startBridge(doc)
        try {
            setYCell(doc, 'sheet1', 2, 1, '=A1-A1')
            expect(cell(doc, 2, 1)?.raw).toBe(0)
            expect(cell(doc, 2, 1)?.style?.numFmt).toBeUndefined()
        } finally {
            bridge.stop()
        }
    })

    it('keeps text that looks like a date as text', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, workbook())
        const bridge = startBridge(doc)
        try {
            setYCell(doc, 'sheet1', 2, 2, '=B1')
            setYCell(doc, 'sheet1', 2, 3, '=C1')
            expect(cell(doc, 2, 2)?.raw).toBe('12/6/24')
            expect(cell(doc, 2, 3)?.raw).toBe('=not a formula')
        } finally {
            bridge.stop()
        }
    })

    it('reads a typed US date as a date', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, workbook())
        const bridge = startBridge(doc)
        try {
            setYCell(doc, 'sheet1', 3, 1, '12/31/2025')
            setYCell(doc, 'sheet1', 3, 2, '=A3+1')
            expect(cell(doc, 3, 2)?.raw).toBe(46023)
        } finally {
            bridge.stop()
        }
    })
})
