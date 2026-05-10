import { normalizeColor } from '../normalize-color'
import type { CellStyle } from '../workbook-types'

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
        const BORDER = '1px solid #000000'
        if (borders.top) parts.push(`border-top:${BORDER}`)
        if (borders.right) parts.push(`border-right:${BORDER}`)
        if (borders.bottom) parts.push(`border-bottom:${BORDER}`)
        if (borders.left) parts.push(`border-left:${BORDER}`)
    }

    if (parts.length === 0) return ''
    return `${parts.join(';')};`
}
