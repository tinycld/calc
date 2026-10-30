import { describe, expect, it } from 'vitest'
import { cellStyleToRenderProps } from '../tinycld/calc/lib/cell-style-render'

// cellStyleToRenderProps maps a partial CellStyle onto RN style props.
// The contract: only attributes present on the input map to outputs;
// unset attributes leave the empty defaults intact so the cell render
// path can spread the result over its className-derived defaults
// without overriding them.

describe('cellStyleToRenderProps — defaults', () => {
    // An unstyled cell renders the way Sheets and Excel render one:
    // 10pt text, bottom-aligned, left-aligned text and right-aligned
    // numbers.
    it('undefined style is 10pt, bottom-aligned, one line', () => {
        const out = cellStyleToRenderProps(undefined)
        expect(out.textStyle.fontSize).toBeCloseTo(13.333, 2)
        expect(out.viewStyle.justifyContent).toBe('flex-end')
        expect(out.numberOfLines).toBe(1)
    })

    it('text aligns left by default', () => {
        const out = cellStyleToRenderProps({}, { kind: 'string', raw: 'a' })
        expect(out.textStyle.textAlign).toBe('left')
        expect(out.viewStyle.alignItems).toBe('flex-start')
    })

    it('numbers, dates and numeric formula results align right by default', () => {
        for (const content of [
            { kind: 'number' as const, raw: 1 },
            { kind: 'date' as const, raw: '2024-12-06' },
            { kind: 'formula' as const, raw: 5 },
        ]) {
            const out = cellStyleToRenderProps({ alignment: { vertical: 'bottom' } }, content)
            expect(out.textStyle.textAlign).toBe('right')
            expect(out.viewStyle.alignItems).toBe('flex-end')
        }
    })

    it('booleans and error results center by default', () => {
        expect(cellStyleToRenderProps({}, { kind: 'boolean', raw: true }).textStyle.textAlign).toBe(
            'center'
        )
        expect(
            cellStyleToRenderProps({}, { kind: 'formula', raw: '#DIV/0!' }).textStyle.textAlign
        ).toBe('center')
    })

    it('a text formula result aligns left', () => {
        expect(
            cellStyleToRenderProps({}, { kind: 'formula', raw: 'abc' }).textStyle.textAlign
        ).toBe('left')
    })

    it('an explicit horizontal alignment wins over the default', () => {
        const out = cellStyleToRenderProps(
            { alignment: { horizontal: 'left' } },
            { kind: 'number', raw: 1 }
        )
        expect(out.textStyle.textAlign).toBe('left')
    })
})

describe('cellStyleToRenderProps — font', () => {
    it('bold maps to fontWeight: bold', () => {
        const out = cellStyleToRenderProps({ font: { bold: true } })
        expect(out.textStyle.fontWeight).toBe('bold')
    })

    it('italic maps to fontStyle: italic', () => {
        const out = cellStyleToRenderProps({ font: { italic: true } })
        expect(out.textStyle.fontStyle).toBe('italic')
    })

    it('underline maps to textDecorationLine: underline', () => {
        const out = cellStyleToRenderProps({ font: { underline: true } })
        expect(out.textStyle.textDecorationLine).toBe('underline')
    })

    it('strike maps to textDecorationLine: line-through', () => {
        const out = cellStyleToRenderProps({ font: { strike: true } })
        expect(out.textStyle.textDecorationLine).toBe('line-through')
    })

    it('underline + strike combine into "underline line-through"', () => {
        const out = cellStyleToRenderProps({ font: { underline: true, strike: true } })
        expect(out.textStyle.textDecorationLine).toBe('underline line-through')
    })

    it('size is in points and renders in pixels', () => {
        const out = cellStyleToRenderProps({ font: { size: 12 } })
        expect(out.textStyle.fontSize).toBe(16)
    })

    it('font name maps to a fontFamily stack with a fallback', () => {
        const out = cellStyleToRenderProps({ font: { name: 'Calibri' } })
        expect(out.textStyle.fontFamily).toBe('Calibri, Carlito, sans-serif')
    })

    it('color in #RRGGBB form passes through', () => {
        const out = cellStyleToRenderProps({ font: { color: '#ff0000' } })
        expect(out.textStyle.color).toBe('#ff0000')
    })

    it('color in excelize FFRRGGBB form drops the alpha prefix', () => {
        const out = cellStyleToRenderProps({ font: { color: 'FF112233' } })
        expect(out.textStyle.color).toBe('#112233')
    })

    it('color in excelize RRGGBB form gets a leading #', () => {
        const out = cellStyleToRenderProps({ font: { color: '112233' } })
        expect(out.textStyle.color).toBe('#112233')
    })

    it('false bold/italic do not set the property', () => {
        const out = cellStyleToRenderProps({ font: { bold: false, italic: false } })
        expect(out.textStyle.fontWeight).toBeUndefined()
        expect(out.textStyle.fontStyle).toBeUndefined()
    })
})

// The workbook default font (the xlsx "Normal" style font) is the base
// every cell draws in unless its own style names a font or size.
describe('cellStyleToRenderProps — workbook default font', () => {
    const arial10 = { name: 'Arial', size: 10 }

    it('an unstyled cell takes the default font name and size', () => {
        const out = cellStyleToRenderProps(undefined, undefined, { name: 'Calibri', size: 11 })
        expect(out.textStyle.fontSize).toBeCloseTo(14.667, 2)
        expect(out.textStyle.fontFamily).toBe('Calibri, Carlito, sans-serif')
    })

    it("a cell's own size and name win over the default", () => {
        const out = cellStyleToRenderProps(
            { font: { name: 'Georgia', size: 18 } },
            undefined,
            arial10
        )
        expect(out.textStyle.fontSize).toBe(24)
        expect(out.textStyle.fontFamily).toBe('Georgia, serif')
    })

    it('a cell with only its own size keeps the default family', () => {
        const out = cellStyleToRenderProps({ font: { size: 12 } }, undefined, arial10)
        expect(out.textStyle.fontSize).toBe(16)
        expect(out.textStyle.fontFamily).toBe('Arial, "Liberation Sans", Helvetica, sans-serif')
    })

    it('a cell with only its own name keeps the default size', () => {
        const out = cellStyleToRenderProps({ font: { name: 'Verdana', bold: true } }, undefined, {
            name: 'Arial',
            size: 9,
        })
        expect(out.textStyle.fontSize).toBe(12)
        expect(out.textStyle.fontFamily).toBe('Verdana, sans-serif')
        expect(out.textStyle.fontWeight).toBe('bold')
    })

    it('an empty default font falls back to 10pt in the platform font', () => {
        const out = cellStyleToRenderProps(undefined, undefined, {})
        expect(out.textStyle.fontSize).toBeCloseTo(13.333, 2)
        expect(out.textStyle.fontFamily).toBeUndefined()
    })

    it('a non-positive default size is ignored', () => {
        const out = cellStyleToRenderProps(undefined, undefined, { size: 0 })
        expect(out.textStyle.fontSize).toBeCloseTo(13.333, 2)
    })
})

describe('cellStyleToRenderProps — fill', () => {
    it('fgColor maps to backgroundColor', () => {
        const out = cellStyleToRenderProps({ fill: { fgColor: 'FFEEEEEE' } })
        expect(out.viewStyle.backgroundColor).toBe('#EEEEEE')
    })

    it('bgColor falls back when no fgColor is present', () => {
        const out = cellStyleToRenderProps({ fill: { bgColor: 'FFEEEEEE' } })
        expect(out.viewStyle.backgroundColor).toBe('#EEEEEE')
    })

    it('empty color string is ignored', () => {
        const out = cellStyleToRenderProps({ fill: { fgColor: '' } })
        expect(out.viewStyle.backgroundColor).toBeUndefined()
    })
})

describe('cellStyleToRenderProps — borders', () => {
    const blackThin = { style: 'thin' as const, color: '#000000' }

    it('all four edges produce border widths and colors', () => {
        const out = cellStyleToRenderProps({
            borders: {
                top: blackThin,
                right: blackThin,
                bottom: blackThin,
                left: blackThin,
            },
        })
        expect(out.viewStyle.borderTopWidth).toBe(1)
        expect(out.viewStyle.borderRightWidth).toBe(1)
        expect(out.viewStyle.borderBottomWidth).toBe(1)
        expect(out.viewStyle.borderLeftWidth).toBe(1)
        expect(out.viewStyle.borderTopColor).toBe('#000000')
    })

    it('only the painted edges (object) get widths; false edges are clears, absent are no-ops', () => {
        const out = cellStyleToRenderProps({
            borders: { top: blackThin, right: false, bottom: blackThin, left: false },
        })
        expect(out.viewStyle.borderTopWidth).toBe(1)
        expect(out.viewStyle.borderBottomWidth).toBe(1)
        expect(out.viewStyle.borderRightWidth).toBeUndefined()
        expect(out.viewStyle.borderLeftWidth).toBeUndefined()
    })

    it('an empty borders object adds no border props', () => {
        const out = cellStyleToRenderProps({ borders: {} })
        expect(out.viewStyle.borderTopWidth).toBeUndefined()
        expect(out.viewStyle.borderBottomWidth).toBeUndefined()
    })

    it('per-edge color survives onto borderColor', () => {
        const out = cellStyleToRenderProps({
            borders: { top: { style: 'thin', color: '#FF0000' } },
        })
        expect(out.viewStyle.borderTopWidth).toBe(1)
        expect(out.viewStyle.borderTopColor).toBe('#FF0000')
    })

    it('width derives from line style: medium=2, thick=3, double=3, dashed/dotted/thin=1', () => {
        const widthFor = (style: 'medium' | 'thick' | 'double' | 'dashed' | 'dotted' | 'thin') =>
            cellStyleToRenderProps({ borders: { top: { style, color: '#000000' } } }).viewStyle
                .borderTopWidth
        expect(widthFor('medium')).toBe(2)
        expect(widthFor('thick')).toBe(3)
        expect(widthFor('double')).toBe(3)
        expect(widthFor('dashed')).toBe(1)
        expect(widthFor('dotted')).toBe(1)
        expect(widthFor('thin')).toBe(1)
    })

    it('borderStyle picks dashed > dotted > solid across the four edges', () => {
        // RN borderStyle is shared across all four edges. Mixed styles
        // collapse to one: dashed wins, dotted second, everything else
        // (medium/thick/double/thin) downgrades to solid.
        const dashedTop = cellStyleToRenderProps({
            borders: {
                top: { style: 'dashed', color: '#000' },
                right: { style: 'thick', color: '#000' },
            },
        })
        expect(dashedTop.viewStyle.borderStyle).toBe('dashed')

        const dottedOnly = cellStyleToRenderProps({
            borders: {
                top: { style: 'dotted', color: '#000' },
                bottom: { style: 'medium', color: '#000' },
            },
        })
        expect(dottedOnly.viewStyle.borderStyle).toBe('dotted')

        const allSolid = cellStyleToRenderProps({
            borders: {
                top: { style: 'thin', color: '#000' },
                left: { style: 'double', color: '#000' },
            },
        })
        expect(allSolid.viewStyle.borderStyle).toBe('solid')
    })
})

describe('cellStyleToRenderProps — alignment', () => {
    it('horizontal: right maps to textAlign + alignItems', () => {
        const out = cellStyleToRenderProps({ alignment: { horizontal: 'right' } })
        expect(out.textStyle.textAlign).toBe('right')
        expect(out.viewStyle.alignItems).toBe('flex-end')
    })

    it('horizontal: center maps to center', () => {
        const out = cellStyleToRenderProps({ alignment: { horizontal: 'center' } })
        expect(out.textStyle.textAlign).toBe('center')
        expect(out.viewStyle.alignItems).toBe('center')
    })

    it('vertical: top maps to flex-start', () => {
        const out = cellStyleToRenderProps({ alignment: { vertical: 'top' } })
        expect(out.viewStyle.justifyContent).toBe('flex-start')
    })

    it('vertical: bottom maps to flex-end', () => {
        const out = cellStyleToRenderProps({ alignment: { vertical: 'bottom' } })
        expect(out.viewStyle.justifyContent).toBe('flex-end')
    })

    it('wrapText sets numberOfLines to undefined (no clamp)', () => {
        const out = cellStyleToRenderProps({ alignment: { wrapText: true } })
        expect(out.numberOfLines).toBeUndefined()
    })

    it('without wrapText, numberOfLines is 1', () => {
        const out = cellStyleToRenderProps({ alignment: { horizontal: 'left' } })
        expect(out.numberOfLines).toBe(1)
    })
})

describe('cellStyleToRenderProps — combined', () => {
    it('font + fill + alignment compose without conflict', () => {
        const out = cellStyleToRenderProps({
            font: { bold: true, color: 'FF222222' },
            fill: { fgColor: 'FFFFFF00' },
            alignment: { horizontal: 'right', vertical: 'middle', wrapText: true },
        })
        expect(out.textStyle.fontWeight).toBe('bold')
        expect(out.textStyle.color).toBe('#222222')
        expect(out.textStyle.textAlign).toBe('right')
        expect(out.viewStyle.backgroundColor).toBe('#FFFF00')
        expect(out.viewStyle.alignItems).toBe('flex-end')
        expect(out.viewStyle.justifyContent).toBe('center')
        expect(out.numberOfLines).toBeUndefined()
    })
})
