import { useMemo } from 'react'
import {
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    ScrollView,
    type TextInput,
    View,
} from 'react-native'
import type { DragState } from '../../hooks/use-column-resize'
import type { RemotePresence } from '../../hooks/use-presence'
import type { RowDragState } from '../../hooks/use-row-resize'
import type { SheetWithId } from '../../hooks/use-y-sheets'
import type { FormulaSpecialKey } from '../FormulaBar'
import { Cell } from './Cell'
import {
    LocalSelectionOverlay,
    RefDragOverlay,
    RemoteOverlays,
    ResizePreviewLine,
    RowResizePreviewLine,
} from './overlays'

interface BodyProps {
    horizontalRef: React.RefObject<ScrollView | null>
    verticalRef: React.RefObject<ScrollView | null>
    contentWidth: number
    contentHeight: number
    colOffsets: Float64Array
    rowOffsets: Float64Array
    colDragState: DragState | null
    rowDragState: RowDragState | null
    visible: { firstRow: number; lastRow: number; firstCol: number; lastCol: number }
    sheet: SheetWithId | null
    cellEditorInputRef: React.RefObject<TextInput | null>
    presenceOnSheet: RemotePresence[]
    readOnly: boolean
    onSpecialKey: (key: FormulaSpecialKey) => boolean
    onLayout: (e: LayoutChangeEvent) => void
    onHorizontalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onVerticalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
}

export function Body({
    horizontalRef,
    verticalRef,
    contentWidth,
    contentHeight,
    colOffsets,
    rowOffsets,
    colDragState,
    rowDragState,
    visible,
    sheet,
    cellEditorInputRef,
    presenceOnSheet,
    readOnly,
    onSpecialKey,
    onLayout,
    onHorizontalScroll,
    onVerticalScroll,
}: BodyProps) {
    const sheetId = sheet?.id ?? ''

    // Map "row:col" → first remote editor occupying that cell. Lifted
    // out of <Cell> so cells don't subscribe to presence individually
    // (one subscription per visible cell would re-render the whole
    // viewport on every keystroke from any peer).
    const remoteEditingByCell = useMemo(() => {
        const m = new Map<string, RemotePresence>()
        for (const p of presenceOnSheet) {
            if (p.editing == null) continue
            m.set(`${p.editing.row}:${p.editing.col}`, p)
        }
        return m
    }, [presenceOnSheet])

    const cells: React.ReactNode[] = []
    if (sheet != null) {
        for (let row = visible.firstRow; row <= visible.lastRow; row++) {
            const top = rowOffsets[row - 1]
            const height = rowOffsets[row] - top
            // Hidden rows (height 0): skip entirely. Range still
            // covers them for keyboard nav consistency but no
            // 0-height Pressable is painted.
            if (height <= 0) continue
            for (let col = visible.firstCol; col <= visible.lastCol; col++) {
                const left = colOffsets[col - 1]
                const width = colOffsets[col] - left
                if (width <= 0) continue
                const remoteEditor = remoteEditingByCell.get(`${row}:${col}`) ?? null
                cells.push(
                    <Cell
                        key={`${row}:${col}`}
                        sheetId={sheetId}
                        row={row}
                        col={col}
                        left={left}
                        top={top}
                        width={width}
                        height={height}
                        readOnly={readOnly}
                        cellEditorInputRef={cellEditorInputRef}
                        remoteEditor={remoteEditor}
                        onSpecialKey={onSpecialKey}
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                    />
                )
            }
        }
    }

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
                    <RemoteOverlays
                        presenceOnSheet={presenceOnSheet}
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                    />
                    <LocalSelectionOverlay colOffsets={colOffsets} rowOffsets={rowOffsets} />
                    <RefDragOverlay colOffsets={colOffsets} rowOffsets={rowOffsets} />
                    <ResizePreviewLine
                        dragState={colDragState}
                        colOffsets={colOffsets}
                        contentHeight={contentHeight}
                    />
                    <RowResizePreviewLine
                        dragState={rowDragState}
                        rowOffsets={rowOffsets}
                        contentWidth={contentWidth}
                    />
                </ScrollView>
            </ScrollView>
        </View>
    )
}
