import { describe, expect, it } from 'vitest'
import type { CellStyle } from '../tinycld/calc/lib/workbook-types'
import { cellStyleToInlineCss } from '../tinycld/calc/lib/print/cell-html'

describe('cellStyleToInlineCss', () => {
    it('returns empty string for undefined style', () => {
        expect(cellStyleToInlineCss(undefined)).toBe('')
    })

    it('returns empty string for empty style', () => {
        expect(cellStyleToInlineCss({})).toBe('')
    })

    it('emits font-weight:bold for font.bold', () => {
        expect(cellStyleToInlineCss({ font: { bold: true } })).toContain(
            'font-weight:bold'
        )
    })

    it('emits font-style:italic for font.italic', () => {
        expect(cellStyleToInlineCss({ font: { italic: true } })).toContain(
            'font-style:italic'
        )
    })

    it('combines underline and strike into text-decoration', () => {
        const css = cellStyleToInlineCss({
            font: { underline: true, strike: true },
        })
        expect(css).toContain('text-decoration:underline line-through')
    })

    it('emits underline only', () => {
        const css = cellStyleToInlineCss({ font: { underline: true } })
        expect(css).toContain('text-decoration:underline')
        expect(css).not.toContain('line-through')
    })

    it('emits font-size and font-family', () => {
        const css = cellStyleToInlineCss({
            font: { size: 14, name: 'Arial' },
        })
        expect(css).toContain('font-size:14pt')
        expect(css).toContain('font-family:"Arial"')
    })

    it('emits color for font.color', () => {
        expect(cellStyleToInlineCss({ font: { color: '#FF0000' } })).toContain(
            'color:#FF0000'
        )
    })

    it('normalizes 8-digit FFRRGGBB color to #RRGGBB', () => {
        expect(cellStyleToInlineCss({ font: { color: 'FF112233' } })).toContain(
            'color:#112233'
        )
    })

    it('normalizes 6-digit RRGGBB color by adding #', () => {
        expect(cellStyleToInlineCss({ font: { color: '112233' } })).toContain(
            'color:#112233'
        )
    })

    it('converts 8-digit non-opaque ARGB to rgba()', () => {
        // 80 alpha → 128/255 → ~0.502; rgb part is 11/22/33 hex = 17/34/51.
        // CSS uses #RRGGBBAA byte order while excelize stores AARRGGBB,
        // so we cannot emit `#80112233` (browsers would parse the alpha
        // as red). Emit rgba() to preserve transparency correctly.
        expect(cellStyleToInlineCss({ font: { color: '80112233' } })).toContain(
            'color:rgba(17,34,51,0.502)'
        )
    })

    it('passes through values with leading # unchanged', () => {
        expect(cellStyleToInlineCss({ font: { color: '#ABCDEF' } })).toContain(
            'color:#ABCDEF'
        )
    })

    it('normalizes fill colors too', () => {
        expect(cellStyleToInlineCss({ fill: { fgColor: 'FFAABBCC' } })).toContain(
            'background-color:#AABBCC'
        )
    })

    it('emits background-color from fill.fgColor (preferred)', () => {
        const css = cellStyleToInlineCss({
            fill: { fgColor: '#FFFF00', bgColor: '#00FF00' },
        })
        expect(css).toContain('background-color:#FFFF00')
        expect(css).not.toContain('#00FF00')
    })

    it('falls back to fill.bgColor when fgColor absent', () => {
        expect(
            cellStyleToInlineCss({ fill: { bgColor: '#00FF00' } })
        ).toContain('background-color:#00FF00')
    })

    it('emits text-align from horizontal alignment', () => {
        expect(
            cellStyleToInlineCss({ alignment: { horizontal: 'right' } })
        ).toContain('text-align:right')
    })

    it('emits each set border edge with default style + color', () => {
        const blackThin = { style: 'thin' as const, color: '#000000' }
        const css = cellStyleToInlineCss({
            borders: { top: blackThin, right: blackThin, bottom: false, left: blackThin },
        })
        expect(css).toContain('border-top:1px solid #000000')
        expect(css).toContain('border-right:1px solid #000000')
        expect(css).toContain('border-left:1px solid #000000')
        expect(css).not.toContain('border-bottom')
    })

    it('emits per-edge color from edge.color', () => {
        const css = cellStyleToInlineCss({
            borders: { top: { style: 'thin', color: '#FF0000' } },
        })
        expect(css).toContain('border-top:1px solid #FF0000')
    })

    it('maps line styles: thin/medium/thick → solid + width, dashed/dotted/double → CSS keyword', () => {
        const ofTop = (style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double') =>
            cellStyleToInlineCss({ borders: { top: { style, color: '#000000' } } })
        expect(ofTop('thin')).toContain('border-top:1px solid #000000')
        expect(ofTop('medium')).toContain('border-top:2px solid #000000')
        expect(ofTop('thick')).toContain('border-top:3px solid #000000')
        expect(ofTop('dashed')).toContain('border-top:1px dashed #000000')
        expect(ofTop('dotted')).toContain('border-top:1px dotted #000000')
        expect(ofTop('double')).toContain('border-top:3px double #000000')
    })

    it('combines multiple groups with semicolons', () => {
        const style: CellStyle = {
            font: { bold: true, color: '#333' },
            fill: { fgColor: '#EEE' },
            alignment: { horizontal: 'center' },
        }
        const css = cellStyleToInlineCss(style)
        const declarations = css.split(';').filter(s => s.length > 0)
        expect(declarations.length).toBeGreaterThanOrEqual(3)
    })

    it('handles font names with single quotes (escaping survives HTML round-trip)', () => {
        const css = cellStyleToInlineCss({ font: { name: "O'Reilly" } })
        // Double-quoted CSS string makes apostrophes literal — no escape needed.
        expect(css).toContain("font-family:\"O'Reilly\"")
    })

    it('escapes embedded double quotes in font names', () => {
        const css = cellStyleToInlineCss({ font: { name: 'Weird"Font' } })
        expect(css).toContain('font-family:"Weird\\"Font"')
    })
})
