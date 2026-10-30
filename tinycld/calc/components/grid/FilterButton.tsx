import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Funnel, ListFilter } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'
import { useGridStoreApi } from '../../hooks/use-grid-store'

export type FilterButtonState = 'idle' | 'active' | null

// FILTER_BUTTON_SPACE is the room a header cell keeps clear at its
// right edge for the button, so the header text never runs under it.
export const FILTER_BUTTON_SPACE = 18

interface FilterButtonProps {
    state: FilterButtonState
    col: number
}

// FilterButton sits at the right edge of each header cell of a filtered
// range, as in Sheets, and opens that column's filter. A column that
// has a criterion shows a filled funnel so the user can see which
// columns are filtering rows out.
export function FilterButton({ state, col }: FilterButtonProps) {
    const store = useGridStoreApi()
    const idleColor = useThemeColor('muted-foreground')
    const activeColor = useThemeColor('primary')
    if (state == null) return null
    // The cell under the button captures the pointer on press (its drag
    // gesture), which would turn this click into a cell selection; keep
    // the press to the button. Native gives the inner Pressable the
    // responder first, so it needs nothing.
    const webPointerProp =
        Platform.OS === 'web'
            ? { onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation() }
            : {}
    const Icon = state === 'active' ? Funnel : ListFilter
    return (
        <Pressable
            {...webPointerProp}
            accessibilityRole="button"
            accessibilityLabel={`Filter column ${col}`}
            testID={`calc-filter-button-${col}`}
            onPress={() => store.getState().openFilterDialog(col)}
            hitSlop={4}
            style={{ position: 'absolute', right: 2, bottom: 2, zIndex: 2 }}
        >
            <Icon
                size={13}
                color={state === 'active' ? activeColor : idleColor}
                fill={state === 'active' ? activeColor : 'none'}
            />
        </Pressable>
    )
}
