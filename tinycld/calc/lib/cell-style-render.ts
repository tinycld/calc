import { normalizeColor } from '@tinycld/core/ui/color-picker/normalize-color'
import { Platform, type TextStyle, type ViewStyle } from 'react-native'
import { resolveFontFamily } from './font-family'
import type { WorkbookFont } from './workbook-default-font'
import type {
    CellAlignment,
    CellBorderEdge,
    CellBorderLineStyle,
    CellBorders,
    CellFill,
    CellFont,
    CellKind,
    CellRaw,
    CellStyle,
} from './workbook-types'

// Font sizes in the doc are points, as in xlsx; the screen draws
// pixels (96 per inch, 72 points per inch).
export const DEFAULT_FONT_SIZE_PT = 10

export function pointsToPixels(pt: number): number {
    return (pt * 4) / 3
}

// CellContent is what a cell holds, which decides its default
// ("General") horizontal alignment.
export interface CellContent {
    kind: CellKind
    raw: CellRaw | Date
}

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
// style props the cell render path needs. Attributes the style leaves
// unset get the spreadsheet defaults: the workbook's default font
// (`baseFont`, else 10pt in the platform font), bottom alignment, and
// the "General" horizontal alignment of the cell's content (text
// left, numbers and dates right, booleans and errors centered).
//
// The inverse mapping (xlsx -> CellStyle) lives server-side in
// style_map.go; the forward mapping (CellStyle -> xlsx) in persist.go.
// This file is the third edge of the triangle: CellStyle -> RN render
// props.
export function cellStyleToRenderProps(
    style: CellStyle | undefined,
    content?: CellContent,
    baseFont?: WorkbookFont
): CellRenderStyle {
    const horizontal = horizontalAlignmentStyles(
        style?.alignment?.horizontal ?? generalAlignment(content)
    )
    const fontSize =
        validSize(style?.font?.size) ?? validSize(baseFont?.size) ?? DEFAULT_FONT_SIZE_PT
    const textStyle: TextStyle = {
        fontSize: pointsToPixels(fontSize),
        ...fontFamilyStyle(fontName(style?.font, baseFont)),
        ...horizontal.text,
        ...fontTextStyle(style?.font),
    }
    const viewStyle: ViewStyle = {
        ...horizontal.view,
        ...fillViewStyle(style?.fill),
        ...bordersViewStyle(style?.borders),
        justifyContent: verticalJustify(style?.alignment?.vertical),
    }
    const numberOfLines = style?.alignment?.wrapText ? undefined : 1

    return { viewStyle, textStyle, numberOfLines }
}

function validSize(size: number | undefined): number | undefined {
    return typeof size === 'number' && size > 0 ? size : undefined
}

// A cell's own font name replaces the workbook default even when the
// platform has no family for it: the cell then draws in the system
// font, not the default font's family.
function fontName(font: CellFont | undefined, baseFont: WorkbookFont | undefined) {
    if (typeof font?.name === 'string' && font.name !== '') return font.name
    return baseFont?.name
}

function fontFamilyStyle(name: string | undefined): TextStyle {
    if (typeof name !== 'string' || name === '') return {}
    const family = resolveFontFamily(name, Platform.OS)
    return family != null ? { fontFamily: family } : {}
}

function fontTextStyle(font: CellFont | undefined): TextStyle {
    if (font == null) return {}
    const decoration = textDecorationFor(font)
    return {
        ...(font.bold ? { fontWeight: 'bold' } : {}),
        ...(font.italic ? { fontStyle: 'italic' } : {}),
        ...(decoration != null ? { textDecorationLine: decoration } : {}),
        ...(typeof font.color === 'string' && font.color !== ''
            ? { color: normalizeColor(font.color) }
            : {}),
    }
}

// RN's textDecorationLine accepts at most the combined
// `'underline line-through'`, so build the value from whichever of the
// two flags are set.
function textDecorationFor(font: CellFont): TextStyle['textDecorationLine'] {
    if (font.underline && font.strike) return 'underline line-through'
    if (font.underline) return 'underline'
    if (font.strike) return 'line-through'
    return undefined
}

// Excel fills carry both fgColor (the pattern color) and bgColor (the
// cell background). For solid fills (the only pattern most users care
// about), fgColor IS the visible color. Render path: prefer fgColor
// when present, fall back to bgColor.
function fillViewStyle(fill: CellFill | undefined): ViewStyle {
    const color = fill?.fgColor ?? fill?.bgColor
    if (typeof color !== 'string' || color === '') return {}
    return { backgroundColor: normalizeColor(color) }
}

// Per-edge translation: each edge is either an object describing its
// style + color, the literal `false` (clear; render as no border), or
// absent. RN's `borderStyle` is shared across all four edges and
// limited to solid/dotted/dashed — we pick one for the whole cell with
// preference dashed > dotted > solid and downgrade medium/thick/double
// to solid (the width carries weight on render). The xlsx export path
// preserves the user's full intent; the on-screen render is
// intentionally lossy on mixed line styles.
function bordersViewStyle(borders: CellBorders | undefined): ViewStyle {
    if (borders == null) return {}
    const borderStyle = pickBorderStyle(borders)
    return {
        ...edgeViewStyle('Top', borders.top),
        ...edgeViewStyle('Right', borders.right),
        ...edgeViewStyle('Bottom', borders.bottom),
        ...edgeViewStyle('Left', borders.left),
        ...(borderStyle != null ? { borderStyle } : {}),
    }
}

// edgeViewStyle returns the per-side border width + color for one
// CellBorders edge. `false` and absent edges produce nothing; an object
// edge yields a width derived from its style (medium=2,
// thick/double=3, thin/dashed/dotted=1) and a color via normalizeColor
// (defaulting to black when the edge has no color).
function edgeViewStyle(
    side: 'Top' | 'Right' | 'Bottom' | 'Left',
    edge: CellBorderEdge | false | undefined
): ViewStyle {
    if (edge == null || edge === false) return {}
    const width = widthForStyle(edge.style)
    const color = normalizeColor(edge.color ?? '#000000')
    switch (side) {
        case 'Top':
            return { borderTopWidth: width, borderTopColor: color }
        case 'Right':
            return { borderRightWidth: width, borderRightColor: color }
        case 'Bottom':
            return { borderBottomWidth: width, borderBottomColor: color }
        case 'Left':
            return { borderLeftWidth: width, borderLeftColor: color }
    }
}

// Horizontal alignment lands on both layers: textAlign for the text
// itself, and alignItems on the flex-column container.
function horizontalAlignmentStyles(horizontal: CellAlignment['horizontal']): {
    text: TextStyle
    view: ViewStyle
} {
    switch (horizontal) {
        case 'left':
            return { text: { textAlign: 'left' }, view: { alignItems: 'flex-start' } }
        case 'center':
            return { text: { textAlign: 'center' }, view: { alignItems: 'center' } }
        case 'right':
            return { text: { textAlign: 'right' }, view: { alignItems: 'flex-end' } }
        default:
            return { text: {}, view: {} }
    }
}

// Cells with no vertical alignment sit at the bottom, as in Sheets.
function verticalJustify(vertical: CellAlignment['vertical']): ViewStyle['justifyContent'] {
    switch (vertical) {
        case 'top':
            return 'flex-start'
        case 'middle':
            return 'center'
        default:
            return 'flex-end'
    }
}

// generalAlignment is the "General" horizontal alignment of a cell
// with no explicit one.
function generalAlignment(content: CellContent | undefined): CellAlignment['horizontal'] {
    if (content == null) return 'left'
    const value = content.kind === 'formula' ? content.raw : content.kind
    if (content.kind === 'number' || content.kind === 'date' || typeof value === 'number') {
        return 'right'
    }
    if (content.kind === 'boolean' || typeof value === 'boolean') return 'center'
    if (typeof value === 'string' && FORMULA_ERRORS.has(value)) {
        return 'center'
    }
    return 'left'
}

const FORMULA_ERRORS = new Set([
    '#DIV/0!',
    '#N/A',
    '#NAME?',
    '#NULL!',
    '#NUM!',
    '#REF!',
    '#VALUE!',
    '#ERROR!',
    '#CYCLE!',
    '#SPILL!',
])

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
    const rank = (s: 'solid' | 'dotted' | 'dashed') => (s === 'dashed' ? 3 : s === 'dotted' ? 2 : 1)
    for (const edge of [borders.top, borders.right, borders.bottom, borders.left]) {
        if (edge == null || edge === false) continue
        const candidate: 'solid' | 'dotted' | 'dashed' =
            edge.style === 'dashed' ? 'dashed' : edge.style === 'dotted' ? 'dotted' : 'solid'
        if (best == null || rank(candidate) > rank(best)) best = candidate
    }
    return best
}

// mergeCellStyles composes two partial CellStyles, with `overlay`
// winning per leaf attribute. Used by the cell render path to stack a
// conditional-formatting rule's style on top of the cell's explicit
// style: the rule's `font.color` overrides the cell's `font.color`,
// but the cell's `font.bold` survives if the rule doesn't set it.
//
// "Per leaf" is shallow inside groups: every key the overlay sets
// replaces the base's matching key, and other keys in the same group
// come through from the base unchanged. For border edges (which are
// themselves objects), the overlay edge wholesale replaces the base
// edge — matching the existing setYCellStyle merge semantics.
//
// Returns undefined when both inputs are absent.
export function mergeCellStyles(
    base: CellStyle | undefined,
    overlay: CellStyle | undefined
): CellStyle | undefined {
    if (base == null && overlay == null) return undefined
    if (overlay == null) return base
    if (base == null) return overlay
    const out: CellStyle = {}
    const font = mergeFont(base.font, overlay.font)
    if (font != null) out.font = font
    const fill = mergeFill(base.fill, overlay.fill)
    if (fill != null) out.fill = fill
    const alignment = mergeAlignment(base.alignment, overlay.alignment)
    if (alignment != null) out.alignment = alignment
    const borders = mergeBorders(base.borders, overlay.borders)
    if (borders != null) out.borders = borders
    const numFmt = overlay.numFmt ?? base.numFmt
    if (numFmt != null) out.numFmt = numFmt
    return out
}

function mergeFont(
    base: CellFont | undefined,
    overlay: CellFont | undefined
): CellFont | undefined {
    if (base == null && overlay == null) return undefined
    if (overlay == null) return base
    if (base == null) return overlay
    return { ...base, ...overlay }
}

function mergeFill(
    base: CellFill | undefined,
    overlay: CellFill | undefined
): CellFill | undefined {
    if (base == null && overlay == null) return undefined
    if (overlay == null) return base
    if (base == null) return overlay
    return { ...base, ...overlay }
}

function mergeAlignment(
    base: CellAlignment | undefined,
    overlay: CellAlignment | undefined
): CellAlignment | undefined {
    if (base == null && overlay == null) return undefined
    if (overlay == null) return base
    if (base == null) return overlay
    return { ...base, ...overlay }
}

function mergeBorders(
    base: CellBorders | undefined,
    overlay: CellBorders | undefined
): CellBorders | undefined {
    if (base == null && overlay == null) return undefined
    if (overlay == null) return base
    if (base == null) return overlay
    return {
        top: overlay.top !== undefined ? overlay.top : base.top,
        right: overlay.right !== undefined ? overlay.right : base.right,
        bottom: overlay.bottom !== undefined ? overlay.bottom : base.bottom,
        left: overlay.left !== undefined ? overlay.left : base.left,
    }
}
