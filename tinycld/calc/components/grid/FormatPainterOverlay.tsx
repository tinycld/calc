import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import { useGridStore } from '../../hooks/use-grid-store'

// Paints the marching-ants outline around the format-painter source range
// while the painter is armed. Cleared automatically after the first
// click/drag apply. Uses blue (#2563eb) so the ring is visually distinct
// from the clipboard copy ring.

const PAINTER_STYLE_ID = 'tinycld-calc-painter-ants-style'

// Paintbrush cursor shown while the painter is armed (Excel-style). White
// outline halo under filled shapes so it reads on any background; hotspot
// at the bristle tip (4, 28). Toggled by the `calc-format-painter-active`
// class on <html>, set from Grid's painter effect.
const PAINTER_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><path d="M4 28 L6 20 L12 26 Z"/><path d="M8 21 L21 8 L24 11 L11 24 Z"/><path d="M21 8 L25 4 a2.8 2.8 0 0 1 3 3 L24 11 Z"/></g><path d="M4 28 L6 20 L12 26 Z" fill="#2563eb"/><path d="M8 21 L21 8 L24 11 L11 24 Z" fill="#9ca3af"/><path d="M21 8 L25 4 a2.8 2.8 0 0 1 3 3 L24 11 Z" fill="#1f2937"/></svg>`
const PAINTER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PAINTER_CURSOR_SVG)}") 4 28, copy`

interface FormatPainterOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

export function FormatPainterOverlay({ colOffsets, rowOffsets }: FormatPainterOverlayProps) {
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (document.getElementById(PAINTER_STYLE_ID) != null) return
        const style = document.createElement('style')
        style.id = PAINTER_STYLE_ID
        style.textContent = `
@keyframes tinycld-calc-painter-ants {
    from { background-position: 0 0, 8px 100%, 100% 8px, 0 0; }
    to { background-position: 8px 0, 0 100%, 100% 0, 0 8px; }
}
.tinycld-calc-painter-ants {
    position: absolute;
    pointer-events: none;
    background-image:
        linear-gradient(90deg, #2563eb 50%, transparent 50%),
        linear-gradient(90deg, #2563eb 50%, transparent 50%),
        linear-gradient(0deg, #2563eb 50%, transparent 50%),
        linear-gradient(0deg, #2563eb 50%, transparent 50%);
    background-size: 8px 2px, 8px 2px, 2px 8px, 2px 8px;
    background-position: 0 0, 0 100%, 0 0, 100% 0;
    background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
    animation: tinycld-calc-painter-ants 0.6s linear infinite;
}
html.calc-format-painter-active, html.calc-format-painter-active * {
    cursor: ${PAINTER_CURSOR} !important;
}
`
        document.head.appendChild(style)
    }, [])

    const range = useGridStore(s => s.formatPainterSourceRange)
    if (range == null) return null

    const left = colOffsets[range.startCol - 1] ?? 0
    const right = colOffsets[range.endCol] ?? left
    const width = right - left
    if (width <= 0) return null
    const top = rowOffsets[range.startRow - 1] ?? 0
    const bottom = rowOffsets[range.endRow] ?? top
    const height = bottom - top
    if (height <= 0) return null

    if (Platform.OS === 'web') {
        const webProps = {
            className: 'tinycld-calc-painter-ants',
        } as unknown as Record<string, unknown>
        return (
            <View
                {...webProps}
                pointerEvents="none"
                style={{ position: 'absolute', left, top, width, height }}
            />
        )
    }

    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#2563eb',
            }}
        />
    )
}
