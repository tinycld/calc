import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { stepDecimals } from '../tinycld/calc/lib/number-format/decimal-step'
import { findPresetById } from '../tinycld/calc/lib/number-format/presets'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../tinycld/calc/lib/y-doc-bootstrap'

// useGridFormatControls is a thin orchestrator over setYCellStyle,
// stepDecimals, and findPresetById. These tests exercise the same
// composition (preset lookup → setYCellStyle, current numFmt →
// stepDecimals → setYCellStyle, etc.) directly against a Y.Doc so
// hook-internal React wiring stays out of the way.

function readStyle(doc: Y.Doc, sheetId: string, row: number, col: number) {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)
}

describe('format controls — applyPreset', () => {
    it('currency preset writes the $#,##0.00 numFmt', () => {
        const doc = new Y.Doc()
        const preset = findPresetById('currency')
        expect(preset).toBeDefined()
        setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: preset?.numFmt ?? '' })

        expect(readStyle(doc, 'sheet1', 1, 1)?.numFmt).toBe('$#,##0.00')
    })

    it('percent preset writes the 0.00% numFmt', () => {
        const doc = new Y.Doc()
        const preset = findPresetById('percent')
        setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: preset?.numFmt ?? '' })

        expect(readStyle(doc, 'sheet1', 1, 1)?.numFmt).toBe('0.00%')
    })

    it('automatic preset clears the numFmt (empty string falls back to defaults)', () => {
        const doc = new Y.Doc()
        // Apply a non-default first.
        setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: '#,##0.00' })
        expect(readStyle(doc, 'sheet1', 1, 1)?.numFmt).toBe('#,##0.00')

        // Then the "automatic" preset (numFmt: null) → empty string.
        const auto = findPresetById('automatic')
        setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: auto?.numFmt ?? '' })
        expect(readStyle(doc, 'sheet1', 1, 1)?.numFmt).toBe('')
    })
})

describe('format controls — stepDecimal', () => {
    it('+1 from no format seeds #,##0.0', () => {
        const doc = new Y.Doc()
        const next = stepDecimals(undefined, 1)
        if (next != null) setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: next })

        expect(readStyle(doc, 'sheet1', 1, 1)?.numFmt).toBe('#,##0.0')
    })

    it('-1 from #,##0.00 yields #,##0.0', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: '#,##0.00' })
        const current = readStyle(doc, 'sheet1', 1, 1)?.numFmt
        const next = stepDecimals(current, -1)
        if (next != null) setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: next })

        expect(readStyle(doc, 'sheet1', 1, 1)?.numFmt).toBe('#,##0.0')
    })

    it('+1 preserves the $ prefix in $#,##0.00', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: '$#,##0.00' })
        const current = readStyle(doc, 'sheet1', 1, 1)?.numFmt
        const next = stepDecimals(current, 1)
        if (next != null) setYCellStyle(doc, 'sheet1', 1, 1, { numFmt: next })

        expect(readStyle(doc, 'sheet1', 1, 1)?.numFmt).toBe('$#,##0.000')
    })
})

describe('format controls — font size and color', () => {
    it('setFontSize writes font.size', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { size: 14 } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.font?.size).toBe(14)
    })

    it('setFontColor writes font.color', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { color: '#FF0000' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.font?.color).toBe('#FF0000')
    })

    it('setFontColor with empty string clears the color (treated as default)', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { color: '#FF0000' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.font?.color).toBe('#FF0000')
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { color: '' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.font?.color).toBe('')
    })

    it('font.size and font.color compose with other font flags', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { size: 18, color: '#0000FF' } })
        const style = readStyle(doc, 'sheet1', 1, 1)
        expect(style?.font?.bold).toBe(true)
        expect(style?.font?.size).toBe(18)
        expect(style?.font?.color).toBe('#0000FF')
    })
})

describe('format controls — fill color', () => {
    it('setFillColor writes fill.fgColor', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { fill: { fgColor: '#FFEB3B' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.fill?.fgColor).toBe('#FFEB3B')
    })

    it('setFillColor with empty string clears the fill', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { fill: { fgColor: '#FFEB3B' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.fill?.fgColor).toBe('#FFEB3B')
        setYCellStyle(doc, 'sheet1', 1, 1, { fill: { fgColor: '' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.fill?.fgColor).toBe('')
    })
})

describe('format controls — borders', () => {
    it('all-borders patch writes four true edges', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, {
            borders: { top: true, right: true, bottom: true, left: true },
        })
        const b = readStyle(doc, 'sheet1', 1, 1)?.borders
        expect(b?.top).toBe(true)
        expect(b?.right).toBe(true)
        expect(b?.bottom).toBe(true)
        expect(b?.left).toBe(true)
    })

    it('no-borders patch writes four false edges', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, {
            borders: { top: true, right: true, bottom: true, left: true },
        })
        setYCellStyle(doc, 'sheet1', 1, 1, {
            borders: { top: false, right: false, bottom: false, left: false },
        })
        const b = readStyle(doc, 'sheet1', 1, 1)?.borders
        expect(b?.top).toBe(false)
        expect(b?.right).toBe(false)
        expect(b?.bottom).toBe(false)
        expect(b?.left).toBe(false)
    })
})

describe('format controls — horizontal alignment', () => {
    it('setHorizontalAlign writes alignment.horizontal', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { alignment: { horizontal: 'center' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.alignment?.horizontal).toBe('center')
    })

    it('switching between left/center/right replaces the prior value', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { alignment: { horizontal: 'right' } })
        setYCellStyle(doc, 'sheet1', 1, 1, { alignment: { horizontal: 'left' } })
        expect(readStyle(doc, 'sheet1', 1, 1)?.alignment?.horizontal).toBe('left')
    })
})
