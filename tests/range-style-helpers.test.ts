import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    applyFormatPainterStyles,
    applyFormatPainterToDest,
    applyStyleToRange,
    toggleCellFontAttrInRange,
} from '../tinycld/calc/components/grid/style-helpers'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../tinycld/calc/lib/y-doc-bootstrap'

// Range-aware style helpers are the apply-side of multi-cell selection.
// applyStyleToRange writes the same patch to every cell in a rectangle
// inside one yjs transaction. toggleCellFontAttrInRange adds mixed-
// toggle semantics: any-off → all-on, otherwise all-off, mirroring
// Google Sheets / Excel behavior.

const SHEET = 'sheet1'

function readBold(doc: Y.Doc, row: number, col: number): boolean {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(SHEET, row, col))
    if (cell == null) return false
    return readStyleFromYMap(cell)?.font?.bold === true
}

function readNumFmt(doc: Y.Doc, row: number, col: number): string | undefined {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(SHEET, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)?.numFmt
}

describe('applyStyleToRange', () => {
    it('writes the same patch to every cell in the range', () => {
        const doc = new Y.Doc()
        applyStyleToRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
            {
                font: { bold: true },
            }
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 3; c++) {
                expect(readBold(doc, r, c)).toBe(true)
            }
        }
    })

    it('emits a single afterTransaction event for the whole range', () => {
        const doc = new Y.Doc()
        let count = 0
        doc.on('afterTransaction', () => {
            count += 1
        })
        applyStyleToRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
            {
                numFmt: '#,##0.00',
            }
        )
        // One outer transact wraps all 9 cell writes; the nested
        // setYCellStyle transactions inherit the outer one and don't
        // start their own.
        expect(count).toBe(1)
    })

    it('applies a numFmt patch to a single-cell range', () => {
        const doc = new Y.Doc()
        applyStyleToRange(
            doc,
            SHEET,
            { startRow: 4, startCol: 4, endRow: 4, endCol: 4 },
            {
                numFmt: '0%',
            }
        )
        expect(readNumFmt(doc, 4, 4)).toBe('0%')
    })

    it('is a no-op when doc is null', () => {
        // Should not throw — toolbar callbacks pass null when the
        // workbook is not yet bootstrapped.
        expect(() =>
            applyStyleToRange(
                null,
                SHEET,
                { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
                {
                    font: { bold: true },
                }
            )
        ).not.toThrow()
    })
})

describe('applyFormatPainterStyles (modulo tiling)', () => {
    // numFmt strings double as position markers so we can assert exactly
    // which source cell each destination cell was painted from.
    const SRC = [
        [{ numFmt: 'A' }, { numFmt: 'B' }],
        [{ numFmt: 'C' }, { numFmt: 'D' }],
    ]

    it('tiles a 2×2 source over a larger range with row-major modulo wrap', () => {
        const doc = new Y.Doc()
        applyFormatPainterStyles(doc, SHEET, SRC, {
            startRow: 1,
            startCol: 1,
            endRow: 4,
            endCol: 4,
        })
        // Top-left maps 1:1; the rest wraps every 2 rows / 2 cols.
        expect(readNumFmt(doc, 1, 1)).toBe('A')
        expect(readNumFmt(doc, 1, 2)).toBe('B')
        expect(readNumFmt(doc, 2, 1)).toBe('C')
        expect(readNumFmt(doc, 2, 2)).toBe('D')
        expect(readNumFmt(doc, 3, 3)).toBe('A') // (2%2, 2%2)
        expect(readNumFmt(doc, 4, 4)).toBe('D') // (3%2, 3%2)
        expect(readNumFmt(doc, 4, 1)).toBe('C') // (3%2, 0)
    })

    it('is a no-op when the source has no cells', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        applyFormatPainterStyles(doc, SHEET, [], {
            startRow: 1,
            startCol: 1,
            endRow: 2,
            endCol: 2,
        })
        expect(cellsMap.size).toBe(0)
    })
})

describe('applyFormatPainterToDest (single-cell expansion)', () => {
    const SRC = [
        [{ numFmt: 'A' }, { numFmt: 'B' }],
        [{ numFmt: 'C' }, { numFmt: 'D' }],
    ]

    it('expands a single-cell target to the full source dimensions', () => {
        const doc = new Y.Doc()
        applyFormatPainterToDest(doc, SHEET, SRC, {
            startRow: 3,
            startCol: 3,
            endRow: 3,
            endCol: 3,
        })
        expect(readNumFmt(doc, 3, 3)).toBe('A')
        expect(readNumFmt(doc, 3, 4)).toBe('B')
        expect(readNumFmt(doc, 4, 3)).toBe('C')
        expect(readNumFmt(doc, 4, 4)).toBe('D')
        // Nothing painted beyond the expanded block.
        expect(readNumFmt(doc, 3, 5)).toBeUndefined()
        expect(readNumFmt(doc, 5, 3)).toBeUndefined()
    })

    it('tiles a multi-cell target as-is without expanding past it', () => {
        const doc = new Y.Doc()
        // One-row destination must stay one row even though the source
        // has two — the painter only auto-grows single-cell targets.
        applyFormatPainterToDest(doc, SHEET, SRC, {
            startRow: 1,
            startCol: 1,
            endRow: 1,
            endCol: 3,
        })
        expect(readNumFmt(doc, 1, 1)).toBe('A')
        expect(readNumFmt(doc, 1, 2)).toBe('B')
        expect(readNumFmt(doc, 1, 3)).toBe('A') // col wraps
        expect(readNumFmt(doc, 2, 1)).toBeUndefined()
    })
})

describe('toggleCellFontAttrInRange (mixed-toggle semantics)', () => {
    it('promotes the whole range to bold when any cell is currently un-bold', () => {
        const doc = new Y.Doc()
        // Bold one corner; leave the rest un-bold.
        setYCellStyle(doc, SHEET, 1, 1, { font: { bold: true } })
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
            'bold'
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                expect(readBold(doc, r, c)).toBe(true)
            }
        }
    })

    it('clears the whole range when every cell is already bold', () => {
        const doc = new Y.Doc()
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                setYCellStyle(doc, SHEET, r, c, { font: { bold: true } })
            }
        }
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
            'bold'
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                expect(readBold(doc, r, c)).toBe(false)
            }
        }
    })

    it('promotes when the entire range is empty (treats missing as off)', () => {
        const doc = new Y.Doc()
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
            'bold'
        )
        for (let r = 1; r <= 2; r++) {
            for (let c = 1; c <= 2; c++) {
                expect(readBold(doc, r, c)).toBe(true)
            }
        }
    })

    it('preserves the single-cell flip behavior when range is one cell', () => {
        const doc = new Y.Doc()
        // First toggle on an empty cell: off → on (any-off true).
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 3, startCol: 3, endRow: 3, endCol: 3 },
            'bold'
        )
        expect(readBold(doc, 3, 3)).toBe(true)
        // Second toggle: on → off (any-off false → next = false).
        toggleCellFontAttrInRange(
            doc,
            SHEET,
            { startRow: 3, startCol: 3, endRow: 3, endCol: 3 },
            'bold'
        )
        expect(readBold(doc, 3, 3)).toBe(false)
    })
})
