import { Platform, ScrollView, Text, View } from 'react-native'
import {
    type DragState,
    HANDLE_VISUAL_WIDTH,
    NATIVE_HANDLE_HIT_SLOP,
} from '../../hooks/use-column-resize'
import { useGridStore } from '../../hooks/use-grid-store'
import { columnLabel } from '../../lib/workbook-types'
import { ACTIVE_HEADER_INSET_STYLE, HEADER_HEIGHT } from './constants'

interface ColumnHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentWidth: number
    colOffsets: Float64Array
    firstCol: number
    lastCol: number
    makeHandleProps: (col: number) => Record<string, unknown>
    dragState: DragState | null
}

export function ColumnHeader({
    scrollRef,
    contentWidth,
    colOffsets,
    firstCol,
    lastCol,
    makeHandleProps,
    dragState,
}: ColumnHeaderProps) {
    const activeCol = useGridStore(s => s.selected?.col ?? null)
    const cells: React.ReactNode[] = []
    for (let col = firstCol; col <= lastCol; col++) {
        const isActive = col === activeCol
        const left = colOffsets[col - 1]
        const width = colOffsets[col] - left
        // Hidden columns (width 0 from a drag-to-zero) still need to
        // occupy zero pixels of layout space — render nothing rather
        // than a 0×H view to keep the DOM lean.
        if (width > 0) {
            cells.push(
                <View
                    key={`h-${col}`}
                    className={`border-r border-b border-border items-center justify-center ${
                        isActive ? 'bg-accent' : 'bg-surface-secondary'
                    }`}
                    style={{
                        position: 'absolute',
                        left,
                        top: 0,
                        width,
                        height: HEADER_HEIGHT,
                        ...(isActive ? ACTIVE_HEADER_INSET_STYLE : null),
                    }}
                >
                    <Text
                        className={`text-xs ${isActive ? 'text-accent-foreground' : 'text-muted-foreground'}`}
                        style={isActive ? { fontWeight: 'bold' } : undefined}
                    >
                        {columnLabel(col)}
                    </Text>
                </View>
            )
        }
        // Resize handle straddles the right boundary of column `col`.
        // Position it at left+width-half so it visually sits ON the
        // boundary line. On native we also enlarge the touchable
        // area beyond the visible 6px stripe via hitSlop equivalent
        // (a wider transparent View extending into both columns).
        const handleX = left + width - HANDLE_VISUAL_WIDTH / 2
        const isDraggingThis = dragState?.col === col
        cells.push(
            <View
                key={`g-${col}`}
                {...makeHandleProps(col)}
                style={
                    {
                        position: 'absolute',
                        left: handleX - (Platform.OS === 'web' ? 0 : NATIVE_HANDLE_HIT_SLOP),
                        top: 0,
                        width:
                            HANDLE_VISUAL_WIDTH +
                            (Platform.OS === 'web' ? 0 : NATIVE_HANDLE_HIT_SLOP * 2),
                        height: HEADER_HEIGHT,
                        zIndex: 2,
                        // Web-only cursor affordance. RN-Web compiles
                        // unrecognized style keys to inline CSS, so this
                        // forwards through. Native doesn't have a cursor
                        // concept; the wider hit slop is the affordance.
                        cursor: 'col-resize',
                        // Subtle visible bar centered on the handle so the
                        // grab target is discoverable on hover; flat (no
                        // border) when not dragged so it doesn't compete
                        // with the column-divider line that's already
                        // there.
                        backgroundColor: isDraggingThis ? '#22a06b' : 'transparent',
                        // biome-ignore lint/suspicious/noExplicitAny: web-only cursor key on RN ViewStyle
                    } as any
                }
            />
        )
    }
    // Outer flex-1 wrapper sets the visible width (= viewport-sized clip
    // region); the ScrollView fills it. We can't put `flex: 1` directly on
    // the ScrollView because RN-Web's ScrollView ships `flex: 1 1 auto`
    // and inline `width` on the same node loses to flex sizing.
    return (
        <View style={{ flex: 1, height: HEADER_HEIGHT, overflow: 'hidden' }}>
            <ScrollView
                ref={scrollRef}
                horizontal
                scrollEnabled={false}
                showsHorizontalScrollIndicator={false}
                style={{ height: HEADER_HEIGHT }}
                contentContainerStyle={{ width: contentWidth, height: HEADER_HEIGHT }}
            >
                {cells}
            </ScrollView>
        </View>
    )
}
