import { normalizeColor } from '../normalize-color'
import type { CellBorderEdge, CellBorderLineStyle, CellStyle } from '../workbook-types'

// cellStyleToInlineCss converts a partial CellStyle into a CSS
// declaration string suitable for the `style` attribute on a print
// <td>. Mirrors the surface area of cellStyleToRenderProps (the on-
// screen RN renderer) but emits CSS. Absence at any nesting level
// means "no declaration" — the printed cell falls back to whatever
// the surrounding table CSS provides.
//
// Border edges use uniform 1px solid #000000 to match the on-screen
// renderer's BORDER_COLOR; per-edge color/style is future work and
// will land here as soon as it lands in cellStyleToRenderProps.
export function cellStyleToInlineCss(style: CellStyle | undefined): string {
    if (style == null) return ''
    const parts: string[] = []

    const font = style.font
    if (font != null) {
        if (font.bold) parts.push('font-weight:bold')
        if (font.italic) parts.push('font-style:italic')
        const decorations: string[] = []
        if (font.underline) decorations.push('underline')
        if (font.strike) decorations.push('line-through')
        if (decorations.length > 0) {
            parts.push(`text-decoration:${decorations.join(' ')}`)
        }
        if (typeof font.size === 'number') {
            // Excel font sizes are in points; CSS `pt` matches print
            // semantics. Browsers translate pt → px at the print engine,
            // so 11pt renders as Excel's default 11pt regardless of the
            // user's screen DPI.
            parts.push(`font-size:${font.size}pt`)
        }
        if (typeof font.name === 'string' && font.name !== '') {
            parts.push(`font-family:"${font.name.replace(/"/g, '\\"')}"`)

        }
        if (typeof font.color === 'string' && font.color !== '') {
            parts.push(`color:${normalizeColor(font.color)}`)
        }
    }

    const fill = style.fill
    if (fill != null) {
        // Same precedence as the RN renderer: prefer fgColor (the
        // pattern color for solid fills), fall back to bgColor.
        const color = fill.fgColor ?? fill.bgColor
        if (typeof color === 'string' && color !== '') {
            parts.push(`background-color:${normalizeColor(color)}`)
        }
    }

    const alignment = style.alignment
    if (alignment != null) {
        if (alignment.horizontal) {
            parts.push(`text-align:${alignment.horizontal}`)
        }
        if (alignment.vertical === 'top') parts.push('vertical-align:top')
        else if (alignment.vertical === 'bottom') parts.push('vertical-align:bottom')
        else if (alignment.vertical === 'middle')
            parts.push('vertical-align:middle')
        if (alignment.wrapText) parts.push('white-space:normal')
    }

    const borders = style.borders
    if (borders != null) {
        // CSS supports per-edge style/color natively, so the print path
        // preserves the user's full intent — unlike the RN render path
        // which downgrades to a single shared borderStyle.
        const edge = (side: 'top' | 'right' | 'bottom' | 'left') => {
            const v = borders[side]
            if (v == null || v === false) return
            parts.push(`border-${side}:${edgeToCss(v)}`)
        }
        edge('top')
        edge('right')
        edge('bottom')
        edge('left')
    }

    if (parts.length === 0) return ''
    return `${parts.join(';')};`
}

// edgeToCss formats one CellBorderEdge as a CSS shorthand value
// (`<width>px <css-style> <color>`). Width follows the same
// medium=2/thick=double=3/else=1 mapping as the RN renderer; CSS
// styles map directly except thin/medium/thick → solid (line weight
// carries those flavors in CSS too).
function edgeToCss(edge: CellBorderEdge): string {
    const width = widthForStyle(edge.style)
    const cssStyle =
        edge.style === 'dashed'
            ? 'dashed'
            : edge.style === 'dotted'
              ? 'dotted'
              : edge.style === 'double'
                ? 'double'
                : 'solid'
    const color = normalizeColor(edge.color ?? '#000000')
    return `${width}px ${cssStyle} ${color}`
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
