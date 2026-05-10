import { Text, View } from 'react-native'
import type { DragState } from '../../hooks/use-column-resize'
import { useGridStore } from '../../hooks/use-grid-store'
import type { RemotePresence } from '../../hooks/use-presence'
import type { RowDragState } from '../../hooks/use-row-resize'

interface RemoteOverlaysProps {
    presenceOnSheet: RemotePresence[]
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// Renders one overlay per remote peer's cursor or editing cell. Lives
// in a fragment so the parent ScrollView can place it inline with the
// cell layer.
export function RemoteOverlays({ presenceOnSheet, colOffsets, rowOffsets }: RemoteOverlaysProps) {
    const overlays: React.ReactNode[] = []
    for (const p of presenceOnSheet) {
        if (p.selection != null && p.editing == null) {
            overlays.push(
                <RemoteSelectionOverlay
                    key={`sel-${p.clientID}`}
                    row={p.selection.row}
                    col={p.selection.col}
                    colOffsets={colOffsets}
                    rowOffsets={rowOffsets}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
        if (p.editing != null) {
            overlays.push(
                <RemoteSelectionOverlay
                    key={`edit-${p.clientID}`}
                    row={p.editing.row}
                    col={p.editing.col}
                    colOffsets={colOffsets}
                    rowOffsets={rowOffsets}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
    }
    return <>{overlays}</>
}

interface LocalSelectionOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// Renders the green selection ring over the selected cell. Only
// visible when there's a selection and no edit session (during edit
// the CellEditor's own border is the visible affordance).
export function LocalSelectionOverlay({ colOffsets, rowOffsets }: LocalSelectionOverlayProps) {
    const selected = useGridStore(s => (s.editSession == null ? s.selected : null))
    if (selected == null) return null
    const left = colOffsets[selected.col - 1] ?? 0
    const width = (colOffsets[selected.col] ?? left) - left
    if (width <= 0) return null
    const top = rowOffsets[selected.row - 1] ?? 0
    const height = (rowOffsets[selected.row] ?? top) - top
    if (height <= 0) return null
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
                borderColor: '#22a06b',
            }}
        />
    )
}

interface RefDragOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// While a ref-drag is in progress, paint a translucent rectangle over
// the chosen range so the user sees the selection they're about to
// commit. Pointer-events disabled so it doesn't block the pan
// gesture.
export function RefDragOverlay({ colOffsets, rowOffsets }: RefDragOverlayProps) {
    const refDrag = useGridStore(s => s.refDrag)
    if (refDrag == null) return null
    const minRow = Math.min(refDrag.anchor.row, refDrag.end.row)
    const maxRow = Math.max(refDrag.anchor.row, refDrag.end.row)
    const minCol = Math.min(refDrag.anchor.col, refDrag.end.col)
    const maxCol = Math.max(refDrag.anchor.col, refDrag.end.col)
    const left = colOffsets[minCol - 1] ?? 0
    const right = colOffsets[maxCol] ?? left
    const width = right - left
    if (width <= 0) return null
    const top = rowOffsets[minRow - 1] ?? 0
    const bottom = rowOffsets[maxRow] ?? top
    const height = bottom - top
    if (height <= 0) return null
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
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.10)',
            }}
        />
    )
}

interface RemoteSelectionOverlayProps {
    row: number
    col: number
    colOffsets: Float64Array
    rowOffsets: Float64Array
    color: string
    name: string
}

function RemoteSelectionOverlay({
    row,
    col,
    colOffsets,
    rowOffsets,
    color,
    name,
}: RemoteSelectionOverlayProps) {
    const left = colOffsets[col - 1] ?? 0
    const width = (colOffsets[col] ?? left) - left
    if (width <= 0) return null
    const top = rowOffsets[row - 1] ?? 0
    const height = (rowOffsets[row] ?? top) - top
    if (height <= 0) return null
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
                borderColor: color,
            }}
        >
            <View
                style={{
                    position: 'absolute',
                    bottom: -16,
                    left: 0,
                    paddingHorizontal: 4,
                    paddingVertical: 1,
                    backgroundColor: color,
                }}
            >
                <Text style={{ color: 'white', fontSize: 9 }} numberOfLines={1}>
                    {name}
                </Text>
            </View>
        </View>
    )
}

interface ResizePreviewLineProps {
    dragState: DragState | null
    colOffsets: Float64Array
    contentHeight: number
}

// Vertical green guide line drawn at the proposed new right-edge of
// the column being resized. Anchored to the absolute body so it
// scrolls with the cells but isn't clipped by per-cell windowing.
// Renders nothing when no drag is active — that's the default state
// the React tree can mount cheaply.
export function ResizePreviewLine({
    dragState,
    colOffsets,
    contentHeight,
}: ResizePreviewLineProps) {
    if (dragState == null) return null
    const left = (colOffsets[dragState.col - 1] ?? 0) + dragState.currentWidth
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: left - 1,
                top: 0,
                width: 2,
                height: contentHeight,
                backgroundColor: '#22a06b',
                opacity: 0.7,
            }}
        />
    )
}

interface RowResizePreviewLineProps {
    dragState: RowDragState | null
    rowOffsets: Float64Array
    contentWidth: number
}

// Horizontal green guide line drawn at the proposed new bottom-edge of
// the row being resized. Mirror of ResizePreviewLine on the row axis.
export function RowResizePreviewLine({
    dragState,
    rowOffsets,
    contentWidth,
}: RowResizePreviewLineProps) {
    if (dragState == null) return null
    const top = (rowOffsets[dragState.row - 1] ?? 0) + dragState.currentHeight
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: 0,
                top: top - 1,
                width: contentWidth,
                height: 2,
                backgroundColor: '#22a06b',
                opacity: 0.7,
            }}
        />
    )
}
