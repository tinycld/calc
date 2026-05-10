import { describe, expect, it } from 'vitest'
import { cellStyleToRenderProps } from '../tinycld/calc/lib/cell-style-render'

// cellStyleToRenderProps maps a partial CellStyle onto RN style props.
// The contract: only attributes present on the input map to outputs;
// unset attributes leave the empty defaults intact so the cell render
// path can spread the result over its className-derived defaults
// without overriding them.

describe('cellStyleToRenderProps — defaults', () => {
    it('undefined style produces empty viewStyle/textStyle and numberOfLines: 1', () => {
        const out = cellStyleToRenderProps(undefined)
        expect(out.viewStyle).toEqual({})
        expect(out.textStyle).toEqual({})
        expect(out.numberOfLines).toBe(1)
    })

    it('empty style object produces the same defaults', () => {
        const out = cellStyleToRenderProps({})
        expect(out.viewStyle).toEqual({})
        expect(out.textStyle).toEqual({})
        expect(out.numberOfLines).toBe(1)
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

    it('size maps to fontSize', () => {
        const out = cellStyleToRenderProps({ font: { size: 16 } })
        expect(out.textStyle.fontSize).toBe(16)
    })

    it('font name maps to fontFamily', () => {
        const out = cellStyleToRenderProps({ font: { name: 'Inter' } })
        expect(out.textStyle.fontFamily).toBe('Inter')
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
    it('all four edges produce border widths and colors', () => {
        const out = cellStyleToRenderProps({
            borders: { top: true, right: true, bottom: true, left: true },
        })
        expect(out.viewStyle.borderTopWidth).toBe(1)
        expect(out.viewStyle.borderRightWidth).toBe(1)
        expect(out.viewStyle.borderBottomWidth).toBe(1)
        expect(out.viewStyle.borderLeftWidth).toBe(1)
        expect(out.viewStyle.borderTopColor).toBe('#000000')
    })

    it('only the truthy edges are painted', () => {
        const out = cellStyleToRenderProps({
            borders: { top: true, right: false, bottom: true, left: false },
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
