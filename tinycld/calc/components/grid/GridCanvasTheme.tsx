import type { LayoutChangeEvent } from 'react-native'
import { View } from 'react-native'
import { ScopedTheme } from 'uniwind'

// The spreadsheet canvas (cells + row/column headers) always renders on
// a LIGHT palette, regardless of the app's light/dark mode — the same
// choice Google Sheets and Excel make. Imported .xlsx cells carry
// explicit font/fill colors authored for a white page (Excel even
// stamps a default black font on plain data cells), so painting them on
// a dark surface makes the data invisible. Pinning the canvas to light
// keeps every imported color faithful and readable.
//
// App chrome (menubar, toolbar, formula bar, sheet tabs, dialogs) is
// intentionally OUTSIDE this wrapper so it keeps following the user's
// theme. Only the grid data area is scoped.
//
// ScopedTheme is uniwind's cross-platform primitive: on web it drops a
// `light`-classed `display:contents` div (triggering the CSS
// `@scope(.dark) to (.light)` re-scoping), and on native it provides a
// context that className resolution + useThemeColor read. So every
// `bg-background` / `text-foreground` / `border-border` and every
// useThemeColor('border') inside resolves the light value.
//
// The inner `bg-background` View is the OPAQUE light backing for the
// whole canvas. Cells paint their own background, but a range-selected
// cell replaces its fill with the translucent selection tint
// (SELECTION_GREEN_TINT) — without an opaque light surface behind it,
// that 90%-transparent tint would reveal the dark app background through
// the cell and read as a near-black block. The backing guarantees the
// tint always composites over light paper.
// `onLayout` fires when the backing View's own geometry OR its position
// within the Grid root changes — including when conditional chrome above
// it (the status banners) mounts/unmounts and shifts the canvas down.
// Grid wires this to its body-top re-measure so the formula-suggestion
// popover anchor stays correct across those shifts (the backing View is
// the popover overlay's offset context on the body axis).
export function GridCanvasTheme({
    children,
    onLayout,
}: {
    children: React.ReactNode
    onLayout?: (e: LayoutChangeEvent) => void
}) {
    return (
        <ScopedTheme theme="light">
            <View className="flex-1 bg-background" onLayout={onLayout}>
                {children}
            </View>
        </ScopedTheme>
    )
}
