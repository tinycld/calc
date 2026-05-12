import type { TextStyle, ViewStyle } from 'react-native'
import { normalizeColor } from './normalize-color'
import type { CellBorderEdge, CellBorderLineStyle, CellStyle } from './workbook-types'

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
        // RN's textDecorationLine accepts at most the combined
        // `'underline line-through'`, so build the value from whichever
        // of the two flags are set.
        const decorations: string[] = []
        if (style.font.underline) decorations.push('underline')
        if (style.font.strike) decorations.push('line-through')
        if (decorations.length > 0) {
            textStyle.textDecorationLine = decorations.join(' ') as
                | 'underline'
                | 'line-through'
                | 'underline line-through'
        }
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

    if (style.borders != null) {
        // Per-edge translation: each edge is either an object describing
        // its style + color, the literal `false` (clear; render as no
        // border), or absent. RN's `borderStyle` is shared across all
        // four edges and limited to solid/dotted/dashed — we pick one
        // for the whole cell with preference dashed > dotted > solid
        // and downgrade medium/thick/double to solid (the width carries
        // weight on render). The xlsx export path preserves the user's
        // full intent; the on-screen render is intentionally lossy on
        // mixed line styles.
        applyEdge(viewStyle, 'Top', style.borders.top)
        applyEdge(viewStyle, 'Right', style.borders.right)
        applyEdge(viewStyle, 'Bottom', style.borders.bottom)
        applyEdge(viewStyle, 'Left', style.borders.left)
        const cellBorderStyle = pickBorderStyle(style.borders)
        if (cellBorderStyle != null) viewStyle.borderStyle = cellBorderStyle
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

// applyEdge sets the per-side border width + color on `viewStyle` for
// one CellBorders edge. `false` and absent edges are no-ops; an object
// edge writes width derived from its style (medium=2, thick/double=3,
// thin/dashed/dotted=1) and color via normalizeColor (defaulting to
// black when the edge has no color).
//
// `side` is the PascalCase RN suffix ("Top", "Right", …). The function
// is a thin assignment shim — keeping it factored avoids repeating the
// width-from-style switch four times in the borders block.
function applyEdge(
    viewStyle: ViewStyle,
    side: 'Top' | 'Right' | 'Bottom' | 'Left',
    edge: CellBorderEdge | false | undefined
): void {
    if (edge == null || edge === false) return
    const widthKey = `border${side}Width` as const
    const colorKey = `border${side}Color` as const
    viewStyle[widthKey] = widthForStyle(edge.style)
    viewStyle[colorKey] = normalizeColor(edge.color ?? '#000000')
}

function widthForStyle(style: CellBorderLineStyle | undefined): number {
    switch (style) {
        case 'medium':
            return 2
        case 'thick':
        case 'double':
            return 3
        default:
            return 1
    }
}

// pickBorderStyle collapses the up-to-four edge styles into a single
// RN `borderStyle` value. RN applies one borderStyle to all four sides
// simultaneously (it has no per-side variant) and only honors
// solid/dotted/dashed; the remaining shapes (medium/thick/double) all
// downgrade to solid. Preference order dashed > dotted > solid keeps
// the most visually distinct value when edges disagree.
function pickBorderStyle(
    borders: NonNullable<CellStyle['borders']>
): 'solid' | 'dotted' | 'dashed' | undefined {
    let best: 'solid' | 'dotted' | 'dashed' | undefined
    const rank = (s: 'solid' | 'dotted' | 'dashed') =>
        s === 'dashed' ? 3 : s === 'dotted' ? 2 : 1
    for (const edge of [borders.top, borders.right, borders.bottom, borders.left]) {
        if (edge == null || edge === false) continue
        const candidate: 'solid' | 'dotted' | 'dashed' =
            edge.style === 'dashed'
                ? 'dashed'
                : edge.style === 'dotted'
                  ? 'dotted'
                  : 'solid'
        if (best == null || rank(candidate) > rank(best)) best = candidate
    }
    return best
}

