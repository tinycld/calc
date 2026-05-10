import type { TextStyle, ViewStyle } from 'react-native'
import type { CellStyle } from './workbook-types'

// CellRenderStyle is the bundle of RN style values produced from a
// partial CellStyle. A single helper produces all three layers
// (container view, inner text, line-clamp count) so the cell render
// path doesn't need to remember which style group lands on which JSX
// node.
//
// Returned values are *partials*: the render path spreads them onto
// the existing className-derived defaults, so unset attributes leave
// the default behavior intact.
//
//   - `viewStyle` carries fill (background color), horizontal
//     alignment (which on a flex-column container maps to
//     alignItems), and vertical alignment (justifyContent).
//   - `textStyle` carries font weight, italic, underline, size, name,
//     and color.
//   - `numberOfLines` is 1 when the cell does NOT wrap (the default,
//     matching Excel's truncation), and undefined when wrapText is
//     enabled (so the Text component renders all wrapped lines).
export interface CellRenderStyle {
    viewStyle: ViewStyle
    textStyle: TextStyle
    numberOfLines: number | undefined
}

// cellStyleToRenderProps converts a partial CellStyle into the RN
// style props the cell render path needs. Only attributes present on
// the input map to output values — absence at any level means "leave
// the defaults alone".
//
// The inverse mapping (excelize -> CellStyle) lives server-side in
// bootstrap.go's readWorkbookCellStyle. The forward mapping (CellStyle
// -> excelize) lives in style_reflect.go's overlayStyle. This file is
// the third edge of the triangle: CellStyle -> RN render props.
export function cellStyleToRenderProps(style: CellStyle | undefined): CellRenderStyle {
    const viewStyle: ViewStyle = {}
    const textStyle: TextStyle = {}
    let numberOfLines: number | undefined = 1

    if (style == null) {
        return { viewStyle, textStyle, numberOfLines }
    }

    if (style.font != null) {
        if (style.font.bold) textStyle.fontWeight = 'bold'
        if (style.font.italic) textStyle.fontStyle = 'italic'
        if (style.font.underline) textStyle.textDecorationLine = 'underline'
        if (typeof style.font.size === 'number') textStyle.fontSize = style.font.size
        if (typeof style.font.name === 'string' && style.font.name !== '') {
            textStyle.fontFamily = style.font.name
        }
        if (typeof style.font.color === 'string' && style.font.color !== '') {
            textStyle.color = normalizeColor(style.font.color)
        }
    }

    if (style.fill != null) {
        // Excel fills carry both fgColor (the pattern color) and
        // bgColor (the cell background). For solid fills (the only
        // pattern most users care about), fgColor IS the visible
        // color. Render path: prefer fgColor when present, fall back
        // to bgColor.
        const color = style.fill.fgColor ?? style.fill.bgColor
        if (typeof color === 'string' && color !== '') {
            viewStyle.backgroundColor = normalizeColor(color)
        }
    }

    if (style.alignment != null) {
        switch (style.alignment.horizontal) {
            case 'left':
                textStyle.textAlign = 'left'
                viewStyle.alignItems = 'flex-start'
                break
            case 'center':
                textStyle.textAlign = 'center'
                viewStyle.alignItems = 'center'
                break
            case 'right':
                textStyle.textAlign = 'right'
                viewStyle.alignItems = 'flex-end'
                break
        }
        switch (style.alignment.vertical) {
            case 'top':
                viewStyle.justifyContent = 'flex-start'
                break
            case 'middle':
                viewStyle.justifyContent = 'center'
                break
            case 'bottom':
                viewStyle.justifyContent = 'flex-end'
                break
        }
        if (style.alignment.wrapText) {
            numberOfLines = undefined
        }
    }

    return { viewStyle, textStyle, numberOfLines }
}

// normalizeColor handles excelize-style hex colors. Excelize stores
// colors as "FFRRGGBB" (8 hex digits including alpha) or "RRGGBB" (no
// alpha). Both need a leading `#` to be RN/CSS color values.
//
// "FF000000" → "#000000" (alpha is opaque — drop it; RN accepts 6/8
// digit hex but the leading FF is the common case so we strip it for
// readability).
function normalizeColor(value: string): string {
    if (value.startsWith('#')) return value
    const upper = value.toUpperCase()
    if (/^[0-9A-F]{8}$/.test(upper)) {
        // Drop the FF alpha prefix for the common opaque case;
        // preserve it for true alpha values so transparency is kept.
        if (upper.startsWith('FF')) {
            return `#${upper.slice(2)}`
        }
        return `#${upper}`
    }
    if (/^[0-9A-F]{6}$/.test(upper)) {
        return `#${upper}`
    }
    return value
}
