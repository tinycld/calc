import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { CellRange } from '../tinycld/calc/hooks/grid-store'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { applyBorderPreset, resolveBorderPatch } from '../tinycld/calc/lib/border-presets'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../tinycld/calc/lib/y-doc-bootstrap'

function readBorders(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)?.borders
}

const range3x3: CellRange = { startRow: 2, endRow: 4, startCol: 2, endCol: 4 }
const range1x1: CellRange = { startRow: 1, endRow: 1, startCol: 1, endCol: 1 }

describe('resolveBorderPatch — all', () => {
    it('every cell gets all four edges true', () => {
        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                expect(resolveBorderPatch('all', range3x3, r, c)).toEqual({
                    top: true,
                    right: true,
                    bottom: true,
                    left: true,
                })
            }
        }
    })
})

describe('resolveBorderPatch — none', () => {
    it('every cell gets all four edges false', () => {
        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                expect(resolveBorderPatch('none', range3x3, r, c)).toEqual({
                    top: false,
                    right: false,
                    bottom: false,
                    left: false,
                })
            }
        }
    })
})

describe('resolveBorderPatch — outer', () => {
    it('top-left corner cell gets only top + left', () => {
        expect(resolveBorderPatch('outer', range3x3, 2, 2)).toEqual({ top: true, left: true })
    })

    it('top-right corner cell gets only top + right', () => {
        expect(resolveBorderPatch('outer', range3x3, 2, 4)).toEqual({ top: true, right: true })
    })

    it('bottom-left corner cell gets only bottom + left', () => {
        expect(resolveBorderPatch('outer', range3x3, 4, 2)).toEqual({ bottom: true, left: true })
    })

    it('bottom-right corner cell gets only bottom + right', () => {
        expect(resolveBorderPatch('outer', range3x3, 4, 4)).toEqual({ bottom: true, right: true })
    })

    it('top edge non-corner cell gets only top', () => {
        expect(resolveBorderPatch('outer', range3x3, 2, 3)).toEqual({ top: true })
    })

    it('bottom edge non-corner cell gets only bottom', () => {
        expect(resolveBorderPatch('outer', range3x3, 4, 3)).toEqual({ bottom: true })
    })

    it('left edge non-corner cell gets only left', () => {
        expect(resolveBorderPatch('outer', range3x3, 3, 2)).toEqual({ left: true })
    })

    it('right edge non-corner cell gets only right', () => {
        expect(resolveBorderPatch('outer', range3x3, 3, 4)).toEqual({ right: true })
    })

    it('interior cell returns null (no patch — preserve existing borders)', () => {
        expect(resolveBorderPatch('outer', range3x3, 3, 3)).toBeNull()
    })

    it('1x1 range gets all four edges (every side faces outward)', () => {
        expect(resolveBorderPatch('outer', range1x1, 1, 1)).toEqual({
            top: true,
            right: true,
            bottom: true,
            left: true,
        })
    })
})

describe('resolveBorderPatch — top', () => {
    it('top row cells get only top', () => {
        expect(resolveBorderPatch('top', range3x3, 2, 2)).toEqual({ top: true })
        expect(resolveBorderPatch('top', range3x3, 2, 3)).toEqual({ top: true })
        expect(resolveBorderPatch('top', range3x3, 2, 4)).toEqual({ top: true })
    })

    it('non-top rows return null', () => {
        expect(resolveBorderPatch('top', range3x3, 3, 3)).toBeNull()
        expect(resolveBorderPatch('top', range3x3, 4, 2)).toBeNull()
    })
})

describe('resolveBorderPatch — bottom', () => {
    it('bottom row cells get only bottom', () => {
        expect(resolveBorderPatch('bottom', range3x3, 4, 2)).toEqual({ bottom: true })
        expect(resolveBorderPatch('bottom', range3x3, 4, 3)).toEqual({ bottom: true })
        expect(resolveBorderPatch('bottom', range3x3, 4, 4)).toEqual({ bottom: true })
    })

    it('non-bottom rows return null', () => {
        expect(resolveBorderPatch('bottom', range3x3, 2, 2)).toBeNull()
        expect(resolveBorderPatch('bottom', range3x3, 3, 3)).toBeNull()
    })
})

describe('applyBorderPreset — outer preserves interior borders', () => {
    it('does not touch a pre-existing interior border when applying outer', () => {
        const doc = new Y.Doc()
        // Pre-existing user-set border on the interior cell.
        setYCellStyle(doc, 'sheet1', 3, 3, {
            borders: { top: true, right: true, bottom: true, left: true },
        })
        applyBorderPreset(doc, 'sheet1', range3x3, 'outer')

        const interior = readBorders(doc, 'sheet1', 3, 3)
        expect(interior?.top).toBe(true)
        expect(interior?.right).toBe(true)
        expect(interior?.bottom).toBe(true)
        expect(interior?.left).toBe(true)
    })

    it('outer paints only the perimeter edges on a 3x3 range', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'outer')

        // Top-left corner.
        expect(readBorders(doc, 'sheet1', 2, 2)).toMatchObject({ top: true, left: true })
        // Top-edge middle.
        const topMid = readBorders(doc, 'sheet1', 2, 3)
        expect(topMid?.top).toBe(true)
        expect(topMid?.bottom).toBeUndefined()
        expect(topMid?.left).toBeUndefined()
        // Bottom-right corner.
        expect(readBorders(doc, 'sheet1', 4, 4)).toMatchObject({ bottom: true, right: true })
        // Interior cell — never written, so no style entry exists.
        expect(readBorders(doc, 'sheet1', 3, 3)).toBeUndefined()
    })
})

describe('applyBorderPreset — none clears every cell', () => {
    it('clears all four edges on every cell in the range, even interior', () => {
        const doc = new Y.Doc()
        // Seed every cell with a full border.
        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                setYCellStyle(doc, 'sheet1', r, c, {
                    borders: { top: true, right: true, bottom: true, left: true },
                })
            }
        }
        applyBorderPreset(doc, 'sheet1', range3x3, 'none')

        for (let r = 2; r <= 4; r++) {
            for (let c = 2; c <= 4; c++) {
                const b = readBorders(doc, 'sheet1', r, c)
                expect(b?.top).toBe(false)
                expect(b?.right).toBe(false)
                expect(b?.bottom).toBe(false)
                expect(b?.left).toBe(false)
            }
        }
    })
})

describe('applyBorderPreset — top/bottom only paint the edge row', () => {
    it('top paints only the top row', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'top')
        expect(readBorders(doc, 'sheet1', 2, 2)?.top).toBe(true)
        expect(readBorders(doc, 'sheet1', 2, 4)?.top).toBe(true)
        expect(readBorders(doc, 'sheet1', 3, 3)).toBeUndefined()
        expect(readBorders(doc, 'sheet1', 4, 4)).toBeUndefined()
    })

    it('bottom paints only the bottom row', () => {
        const doc = new Y.Doc()
        applyBorderPreset(doc, 'sheet1', range3x3, 'bottom')
        expect(readBorders(doc, 'sheet1', 4, 2)?.bottom).toBe(true)
        expect(readBorders(doc, 'sheet1', 4, 4)?.bottom).toBe(true)
        expect(readBorders(doc, 'sheet1', 3, 3)).toBeUndefined()
        expect(readBorders(doc, 'sheet1', 2, 2)).toBeUndefined()
    })
})
