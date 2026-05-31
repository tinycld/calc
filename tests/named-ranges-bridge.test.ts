import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { HyperFormula } from 'hyperformula'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCellTyped } from '../tinycld/calc/hooks/use-y-cell'
import { FormulaBridge } from '../tinycld/calc/lib/formula/bridge'
import { HYPERFORMULA_LICENSE_KEY } from '../tinycld/calc/lib/formula/hyperformula-license'
import {
    propagateNamedRangeSheetDelete,
    propagateNamedRangeSheetRename,
} from '../tinycld/calc/lib/named-ranges/lifecycle'
import {
    listNamedRanges,
    removeNamedRangeByKey,
    writeNamedRange,
} from '../tinycld/calc/lib/named-ranges/y-binding'
import type { WorkbookModel } from '../tinycld/calc/lib/workbook-types'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { bootstrapYDocFromWorkbook, CELLS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

function emptySheet(): WorkbookModel {
    return {
        sheets: [{ name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} }],
    }
}

function twoSheets(): WorkbookModel {
    return {
        sheets: [
            { name: 'Sheet1', rowCount: 5, colCount: 5, cells: {} },
            { name: 'Sheet2', rowCount: 5, colCount: 5, cells: {} },
        ],
    }
}

function readRaw(doc: Y.Doc, sheetId: string, row: number, col: number): unknown {
    return doc
        .getMap<Y.Map<unknown>>(CELLS_MAP)
        .get(yCellKey(sheetId, row, col))
        ?.get('raw')
}

function startBridge(doc: Y.Doc): FormulaBridge {
    const hf = HyperFormula.buildEmpty({ licenseKey: HYPERFORMULA_LICENSE_KEY })
    const bridge = new FormulaBridge(doc, hf)
    bridge.start()
    return bridge
}

describe('FormulaBridge named ranges', () => {
    it('mirrors a global constant name into HF on bootstrap', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        doc.transact(() => {
            writeNamedRange(doc, { name: 'TaxRate', expression: '=0.1', scope: null })
        }, LOCAL_ORIGIN)
        const bridge = startBridge(doc)
        try {
            // A formula that uses the name evaluates to the constant.
            setYCellTyped(doc, 'sheet1', 1, 1, {
                kind: 'formula',
                raw: null,
                display: '=TaxRate*100',
                formula: '=TaxRate*100',
            })
            expect(readRaw(doc, 'sheet1', 1, 1)).toBe(10)
        } finally {
            bridge.stop()
        }
    })

    it('mirrors a range name and recomputes when underlying data changes', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        doc.transact(() => {
            writeNamedRange(doc, {
                name: 'Revenue',
                expression: '=Sheet1!$A$1:$A$3',
                scope: null,
            })
        }, LOCAL_ORIGIN)
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 1, display: '1' })
            setYCellTyped(doc, 'sheet1', 2, 1, { kind: 'number', raw: 2, display: '2' })
            setYCellTyped(doc, 'sheet1', 3, 1, { kind: 'number', raw: 3, display: '3' })
            setYCellTyped(doc, 'sheet1', 1, 2, {
                kind: 'formula',
                raw: null,
                display: '=SUM(Revenue)',
                formula: '=SUM(Revenue)',
            })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(6)

            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 10, display: '10' })
            expect(readRaw(doc, 'sheet1', 1, 2)).toBe(15)
        } finally {
            bridge.stop()
        }
    })

    it('reacts to live add / change / remove of a name', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        const bridge = startBridge(doc)
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, {
                kind: 'formula',
                raw: null,
                display: '=Pi*2',
                formula: '=Pi*2',
            })
            // Before the name exists HF errors out — raw goes to the
            // error sentinel; we only check the dependent recalc
            // happens after the name lands.
            doc.transact(() => {
                writeNamedRange(doc, { name: 'Pi', expression: '=3.14', scope: null })
            }, LOCAL_ORIGIN)
            expect(readRaw(doc, 'sheet1', 1, 1)).toBeCloseTo(6.28)

            doc.transact(() => {
                writeNamedRange(doc, { name: 'Pi', expression: '=3.14159', scope: null })
            }, LOCAL_ORIGIN)
            expect(readRaw(doc, 'sheet1', 1, 1)).toBeCloseTo(6.28318)

            doc.transact(() => {
                removeNamedRangeByKey(doc, 'pi')
            }, LOCAL_ORIGIN)
            // Once removed the formula becomes #NAME?. HF surfaces an
            // error object; readRaw returns either null or the error
            // sentinel — be loose here, just verify the value no
            // longer equals the previous numeric result.
            expect(readRaw(doc, 'sheet1', 1, 1)).not.toBeCloseTo(6.28318)
        } finally {
            bridge.stop()
        }
    })

    it('propagates sheet rename into named-range expressions', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, twoSheets())
        doc.transact(() => {
            writeNamedRange(doc, {
                name: 'Revenue',
                expression: '=Sheet1!$A$1:$A$3',
                scope: null,
            })
        }, LOCAL_ORIGIN)
        doc.transact(() => {
            propagateNamedRangeSheetRename(doc, 'Sheet1', 'Top Line')
        }, LOCAL_ORIGIN)
        const list = listNamedRanges(doc)
        expect(list[0].range.expression).toBe(`='Top Line'!$A$1:$A$3`)
    })

    it('evaluates a cell formula that uses a name present at bootstrap time', () => {
        // Regression guard for the bootstrap ordering: when both the
        // name and a dependent cell formula are already in the Y.Doc
        // before bridge.start() runs, the cell must evaluate against
        // the name (not yield #NAME?). bootstrapCells happens before
        // bootstrapNamedRanges, so HF must recompute on
        // addNamedExpression to make this pass.
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        doc.transact(() => {
            writeNamedRange(doc, { name: 'TaxRate', expression: '=0.2', scope: null })
        }, LOCAL_ORIGIN)
        setYCellTyped(doc, 'sheet1', 1, 1, {
            kind: 'formula',
            raw: null,
            display: '=TaxRate*100',
            formula: '=TaxRate*100',
        })
        const bridge = startBridge(doc)
        try {
            expect(readRaw(doc, 'sheet1', 1, 1)).toBe(20)
        } finally {
            bridge.stop()
        }
    })

    it('fires valuesUpdated subscribers when underlying cells change', () => {
        // Regression guard for useNamedRangePreview: the bridge must
        // notify external subscribers after each recompute so the
        // preview column in the Name Manager stays live as the user
        // edits cells the name references.
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, emptySheet())
        doc.transact(() => {
            writeNamedRange(doc, {
                name: 'Revenue',
                expression: '=Sheet1!$A$1',
                scope: null,
            })
        }, LOCAL_ORIGIN)
        const bridge = startBridge(doc)
        let tickCount = 0
        const unsubscribe = bridge.subscribeToValuesUpdated(() => {
            tickCount++
        })
        try {
            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 100, display: '100' })
            expect(tickCount).toBeGreaterThanOrEqual(1)
            expect(bridge.getNamedExpressionValue('Revenue', null)).toBe(100)

            setYCellTyped(doc, 'sheet1', 1, 1, { kind: 'number', raw: 250, display: '250' })
            expect(tickCount).toBeGreaterThanOrEqual(2)
            expect(bridge.getNamedExpressionValue('Revenue', null)).toBe(250)
        } finally {
            unsubscribe()
            bridge.stop()
        }
    })

    it('drops sheet-scoped named ranges when the scope sheet is deleted', () => {
        const doc = new Y.Doc()
        bootstrapYDocFromWorkbook(doc, twoSheets())
        doc.transact(() => {
            writeNamedRange(doc, {
                name: 'Local',
                expression: '=Sheet2!$A$1',
                scope: 'sheet2',
            })
            writeNamedRange(doc, {
                name: 'Global',
                expression: '=Sheet2!$A$1',
                scope: null,
            })
        }, LOCAL_ORIGIN)
        doc.transact(() => {
            propagateNamedRangeSheetDelete(doc, 'sheet2')
        }, LOCAL_ORIGIN)
        const list = listNamedRanges(doc)
        expect(list.map(e => e.range.name)).toEqual(['Global'])
    })
})
