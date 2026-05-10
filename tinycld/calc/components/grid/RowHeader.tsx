import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import {
    NATIVE_ROW_HANDLE_HIT_SLOP,
    ROW_HANDLE_VISUAL_HEIGHT,
    type RowDragState,
} from '../../hooks/use-row-resize'
import { ACTIVE_HEADER_INSET_STYLE, ROW_HEADER_WIDTH } from './constants'

interface RowHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentHeight: number
    rowOffsets: Float64Array
    firstRow: number
    lastRow: number
    // Number of columns in the sheet — used by selectRow to size the
    // selection range to span the whole row. Passed in (rather than
    // read here) because the header is dimensions-agnostic; Grid
    // already has the canonical value.
    colCount: number
    makeHandleProps: (row: number) => Record<string, unknown>
    dragState: RowDragState | null
}

export function RowHeader({
    scrollRef,
    contentHeight,
    rowOffsets,
    firstRow,
    lastRow,
    colCount,
    makeHandleProps,
    dragState,
}: RowHeaderProps) {
    const activeRow = useGridStore(s => s.selected?.row ?? null)
    // Highlight the row label more strongly when the user has selected
    // the WHOLE row (scope='row') vs. just clicking a body cell that
    // happens to live in this row. Drives the bold/contrast styling
    // below.
    const rowScopeActive = useGridStore(
        s => s.selectionScope === 'row' && s.selected?.row === activeRow
    )
    const store = useGridStoreApi()
    const cells: React.ReactNode[] = []
    for (let row = firstRow; row <= lastRow; row++) {
        const isActive = row === activeRow
        const isRowScope = rowScopeActive && isActive
        const top = rowOffsets[row - 1]
        const height = rowOffsets[row] - top
        // Hidden rows (height 0 from a drag-to-zero) still need to
        // occupy zero pixels of layout space — render nothing rather
        // than a W×0 view to keep the DOM lean.
        if (height > 0) {
            cells.push(
                <Pressable
                    key={`h-${row}`}
                    onPress={() => store.getState().selectRow(row, colCount)}
                    accessibilityLabel={`Select row ${row}`}
                    className={`border-r border-b border-border items-center justify-center ${
                        isActive ? 'bg-accent' : 'bg-surface-secondary'
                    }`}
                    style={{
                        position: 'absolute',
                        left: 0,
                        top,
                        width: ROW_HEADER_WIDTH,
                        height,
                        ...(isActive ? ACTIVE_HEADER_INSET_STYLE : null),
                    }}
                >
                    <Text
                        className={`text-xs ${isActive ? 'text-accent-foreground' : 'text-muted-foreground'}`}
                        style={isActive || isRowScope ? { fontWeight: 'bold' } : undefined}
                    >
                        {row}
                    </Text>
                </Pressable>
            )
        }
        // Resize handle straddles the bottom boundary of row `row`.
        // Mirror of ColumnHeader: the visible 6px stripe sits ON the
        // boundary, with extra hit slop on native.
        const handleY = top + height - ROW_HANDLE_VISUAL_HEIGHT / 2
        const isDraggingThis = dragState?.row === row
        cells.push(
            <View
                key={`g-${row}`}
                {...makeHandleProps(row)}
                style={
                    {
                        position: 'absolute',
                        left: 0,
                        top: handleY - (Platform.OS === 'web' ? 0 : NATIVE_ROW_HANDLE_HIT_SLOP),
                        width: ROW_HEADER_WIDTH,
                        height:
                            ROW_HANDLE_VISUAL_HEIGHT +
                            (Platform.OS === 'web' ? 0 : NATIVE_ROW_HANDLE_HIT_SLOP * 2),
                        zIndex: 2,
                        cursor: 'row-resize',
                        backgroundColor: isDraggingThis ? '#22a06b' : 'transparent',
                        // biome-ignore lint/suspicious/noExplicitAny: web-only cursor key on RN ViewStyle
                    } as any
                }
            />
        )
    }
    return (
        <View style={{ width: ROW_HEADER_WIDTH, overflow: 'hidden' }}>
            <ScrollView
                ref={scrollRef}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ width: ROW_HEADER_WIDTH, height: contentHeight }}
            >
                {cells}
            </ScrollView>
        </View>
    )
}
