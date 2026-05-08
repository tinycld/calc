import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Pressable,
    ScrollView,
    Text,
    View,
} from 'react-native'
import { cellKey, columnLabel, type WorksheetModel } from '../lib/xlsx-adapter'

const CELL_WIDTH = 96
const CELL_HEIGHT = 28
const ROW_HEADER_WIDTH = 48
const HEADER_HEIGHT = CELL_HEIGHT
const OVERSCAN = 4
const MIN_ROWS = 50
const MIN_COLS = 26

export interface GridHandle {
    scrollToCell: (row: number, col: number) => void
}

interface GridProps {
    sheet: WorksheetModel
    minRows?: number
    minCols?: number
}

interface SelectedCell {
    row: number
    col: number
}

export const Grid = forwardRef<GridHandle, GridProps>(function Grid(
    { sheet, minRows = MIN_ROWS, minCols = MIN_COLS },
    ref
) {
    const rows = Math.max(sheet.rowCount, minRows)
    const cols = Math.max(sheet.colCount, minCols)

    const contentWidth = cols * CELL_WIDTH
    const contentHeight = rows * CELL_HEIGHT

    // Scroll position tracked in state for windowing math. Re-renders only
    // when the visible-cell range actually changes (see onScroll below), so
    // the cost is bounded by viewport size, not total cell count.
    const [scrollX, setScrollX] = useState(0)
    const [scrollY, setScrollY] = useState(0)

    // Viewport size measured from the body container's onLayout. Until
    // we've measured we render zero rows/cols — that's one frame, harmless.
    const [viewportWidth, setViewportWidth] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(0)

    const [selected, setSelected] = useState<SelectedCell | null>(null)

    const horizontalRef = useRef<ScrollView>(null)
    const verticalRef = useRef<ScrollView>(null)
    const headerScrollRef = useRef<ScrollView>(null)
    const leftColumnScrollRef = useRef<ScrollView>(null)

    useImperativeHandle(
        ref,
        () => ({
            scrollToCell: (row: number, col: number) => {
                const x = (col - 1) * CELL_WIDTH
                const y = (row - 1) * CELL_HEIGHT
                horizontalRef.current?.scrollTo({ x, animated: true })
                verticalRef.current?.scrollTo({ y, animated: true })
            },
        }),
        []
    )

    const visible = useMemo(() => {
        if (viewportWidth === 0 || viewportHeight === 0) {
            return { firstRow: 1, lastRow: 0, firstCol: 1, lastCol: 0 }
        }
        const firstRow = Math.max(1, Math.floor(scrollY / CELL_HEIGHT) + 1 - OVERSCAN)
        const lastRow = Math.min(rows, Math.ceil((scrollY + viewportHeight) / CELL_HEIGHT) + OVERSCAN)
        const firstCol = Math.max(1, Math.floor(scrollX / CELL_WIDTH) + 1 - OVERSCAN)
        const lastCol = Math.min(cols, Math.ceil((scrollX + viewportWidth) / CELL_WIDTH) + OVERSCAN)
        return { firstRow, lastRow, firstCol, lastCol }
    }, [scrollX, scrollY, viewportWidth, viewportHeight, rows, cols])

    const onHorizontalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x
        setScrollX(x)
        // Mirror to the column header so it stays aligned with the body.
        // Using a ref + scrollTo (rather than absolute-positioning the
        // header inside the body's content) keeps the header in its own
        // sticky region so it doesn't get clipped by row windowing.
        headerScrollRef.current?.scrollTo({ x, animated: false })
    }, [])

    const onVerticalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y
        setScrollY(y)
        leftColumnScrollRef.current?.scrollTo({ y, animated: false })
    }, [])

    const onBodyLayout = useCallback((e: LayoutChangeEvent) => {
        setViewportWidth(e.nativeEvent.layout.width)
        setViewportHeight(e.nativeEvent.layout.height)
    }, [])

    return (
        <View className="flex-1 bg-background">
            <View className="flex-row">
                <CornerCell />
                <ColumnHeader
                    scrollRef={headerScrollRef}
                    contentWidth={contentWidth}
                    firstCol={visible.firstCol}
                    lastCol={visible.lastCol}
                />
            </View>
            <View className="flex-1 flex-row">
                <RowHeader
                    scrollRef={leftColumnScrollRef}
                    contentHeight={contentHeight}
                    firstRow={visible.firstRow}
                    lastRow={visible.lastRow}
                />
                <Body
                    horizontalRef={horizontalRef}
                    verticalRef={verticalRef}
                    contentWidth={contentWidth}
                    contentHeight={contentHeight}
                    visible={visible}
                    sheet={sheet}
                    selected={selected}
                    onSelect={setSelected}
                    onLayout={onBodyLayout}
                    onHorizontalScroll={onHorizontalScroll}
                    onVerticalScroll={onVerticalScroll}
                />
            </View>
        </View>
    )
})

function CornerCell() {
    return (
        <View
            className="bg-surface-secondary border-r border-b border-border"
            style={{ width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }}
        />
    )
}

interface ColumnHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentWidth: number
    firstCol: number
    lastCol: number
}

function ColumnHeader({ scrollRef, contentWidth, firstCol, lastCol }: ColumnHeaderProps) {
    const cells: React.ReactNode[] = []
    for (let col = firstCol; col <= lastCol; col++) {
        cells.push(
            <View
                key={col}
                className="bg-surface-secondary border-r border-b border-border items-center justify-center"
                style={{
                    position: 'absolute',
                    left: (col - 1) * CELL_WIDTH,
                    top: 0,
                    width: CELL_WIDTH,
                    height: HEADER_HEIGHT,
                }}
            >
                <Text className="text-xs text-muted-foreground">{columnLabel(col)}</Text>
            </View>
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

interface RowHeaderProps {
    scrollRef: React.RefObject<ScrollView | null>
    contentHeight: number
    firstRow: number
    lastRow: number
}

function RowHeader({ scrollRef, contentHeight, firstRow, lastRow }: RowHeaderProps) {
    const cells: React.ReactNode[] = []
    for (let row = firstRow; row <= lastRow; row++) {
        cells.push(
            <View
                key={row}
                className="bg-surface-secondary border-r border-b border-border items-center justify-center"
                style={{
                    position: 'absolute',
                    left: 0,
                    top: (row - 1) * CELL_HEIGHT,
                    width: ROW_HEADER_WIDTH,
                    height: CELL_HEIGHT,
                }}
            >
                <Text className="text-xs text-muted-foreground">{row}</Text>
            </View>
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

interface BodyProps {
    horizontalRef: React.RefObject<ScrollView | null>
    verticalRef: React.RefObject<ScrollView | null>
    contentWidth: number
    contentHeight: number
    visible: { firstRow: number; lastRow: number; firstCol: number; lastCol: number }
    sheet: WorksheetModel
    selected: SelectedCell | null
    onSelect: (cell: SelectedCell) => void
    onLayout: (e: LayoutChangeEvent) => void
    onHorizontalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onVerticalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
}

function Body({
    horizontalRef,
    verticalRef,
    contentWidth,
    contentHeight,
    visible,
    sheet,
    selected,
    onSelect,
    onLayout,
    onHorizontalScroll,
    onVerticalScroll,
}: BodyProps) {
    const cells: React.ReactNode[] = []
    for (let row = visible.firstRow; row <= visible.lastRow; row++) {
        for (let col = visible.firstCol; col <= visible.lastCol; col++) {
            const cell = sheet.cells.get(cellKey(row, col))
            cells.push(
                <Pressable
                    key={`${row}:${col}`}
                    onPress={() => onSelect({ row, col })}
                    style={{
                        position: 'absolute',
                        left: (col - 1) * CELL_WIDTH,
                        top: (row - 1) * CELL_HEIGHT,
                        width: CELL_WIDTH,
                        height: CELL_HEIGHT,
                    }}
                    className="border-r border-b border-border bg-background justify-center px-1"
                >
                    <Text className="text-xs text-foreground" numberOfLines={1}>
                        {cell?.display ?? ''}
                    </Text>
                </Pressable>
            )
        }
    }

    const selectionOverlay =
        selected != null ? (
            <View
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left: (selected.col - 1) * CELL_WIDTH,
                    top: (selected.row - 1) * CELL_HEIGHT,
                    width: CELL_WIDTH,
                    height: CELL_HEIGHT,
                    borderWidth: 2,
                    borderColor: '#22a06b',
                }}
            />
        ) : null

    return (
        <View style={{ flex: 1, overflow: 'hidden' }} onLayout={onLayout}>
            <ScrollView
                ref={horizontalRef}
                horizontal
                onScroll={onHorizontalScroll}
                scrollEventThrottle={16}
                showsHorizontalScrollIndicator
                contentContainerStyle={{ width: contentWidth }}
            >
                <ScrollView
                    ref={verticalRef}
                    onScroll={onVerticalScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator
                    style={{ width: contentWidth }}
                    contentContainerStyle={{ width: contentWidth, height: contentHeight }}
                >
                    {cells}
                    {selectionOverlay}
                </ScrollView>
            </ScrollView>
        </View>
    )
}
