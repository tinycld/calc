import { useRef } from 'react'
import { PanResponder, Platform, Pressable, Text, View } from 'react-native'
import type { DragState } from '../../hooks/use-column-resize'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import type { RemotePresence } from '../../hooks/use-presence'
import type { RowDragState } from '../../hooks/use-row-resize'
import { locateCellAtGridCoord } from './style-helpers'

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

// Renders the green selection rectangle. When a multi-cell range is
// active the overlay paints a single outline around the whole
// rectangle, plus a thinner inner outline on the anchor cell so the
// user can still tell which cell is "primary" (the one that drives
// the formula bar and toolbar indicators). When no range is active
// the overlay collapses to the single anchor cell — same behavior as
// the original single-cell selection ring.
//
// Hidden during an edit session: the CellEditor's own border is the
// active-edit affordance.
export function LocalSelectionOverlay({ colOffsets, rowOffsets }: LocalSelectionOverlayProps) {
    const selected = useGridStore(s => (s.editSession == null ? s.selected : null))
    const range = useGridStore(s => (s.editSession == null ? s.selectionRange : null))
    if (selected == null) return null

    // Range bounds when a multi-cell range is active, otherwise the
    // single anchor cell. The math is identical either way — a
    // single-cell rectangle just degenerates to one cell's worth of
    // width and height.
    const startCol = range?.startCol ?? selected.col
    const endCol = range?.endCol ?? selected.col
    const startRow = range?.startRow ?? selected.row
    const endRow = range?.endRow ?? selected.row

    const left = colOffsets[startCol - 1] ?? 0
    const right = colOffsets[endCol] ?? left
    const width = right - left
    if (width <= 0) return null
    const top = rowOffsets[startRow - 1] ?? 0
    const bottom = rowOffsets[endRow] ?? top
    const height = bottom - top
    if (height <= 0) return null

    // Outer rectangle outline. When the range is just the anchor this
    // is the only thing we draw — visually identical to the previous
    // single-cell ring.
    const outer = (
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

    if (range == null) return outer

    // Inner outline on the anchor — slightly thicker so it reads as
    // "the primary cell within the range". Skipped when no range is
    // active because the outer rectangle is already on the anchor.
    const anchorLeft = colOffsets[selected.col - 1] ?? 0
    const anchorRight = colOffsets[selected.col] ?? anchorLeft
    const anchorWidth = anchorRight - anchorLeft
    const anchorTop = rowOffsets[selected.row - 1] ?? 0
    const anchorBottom = rowOffsets[selected.row] ?? anchorTop
    const anchorHeight = anchorBottom - anchorTop
    if (anchorWidth <= 0 || anchorHeight <= 0) return outer
    return (
        <>
            {outer}
            <View
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left: anchorLeft,
                    top: anchorTop,
                    width: anchorWidth,
                    height: anchorHeight,
                    borderWidth: 2,
                    borderColor: '#1a8757',
                    backgroundColor: 'rgba(255, 255, 255, 0.0)',
                }}
            />
        </>
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

interface FillPreviewOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// While a fill-handle drag is in progress, paint a dashed green
// rectangle over the *extension* of the destination range — the
// region strictly outside sourceRange but inside destRange. The
// source itself keeps its own selection ring (LocalSelectionOverlay)
// so drawing the source again here would just double up. Direction
// is one of 'down' | 'right' (never both, by FillDrag's axis-locking
// contract), so the extension is always a single rectangle.
//
// Pointer-events disabled so the dot's drag listener stays in
// control of the gesture for the entire drag.
export function FillPreviewOverlay({ colOffsets, rowOffsets }: FillPreviewOverlayProps) {
    const fillDrag = useGridStore(s => s.fillDrag)
    if (fillDrag == null) return null
    const { sourceRange, destRange, direction } = fillDrag
    if (
        sourceRange.startRow === destRange.startRow &&
        sourceRange.endRow === destRange.endRow &&
        sourceRange.startCol === destRange.startCol &&
        sourceRange.endCol === destRange.endCol
    ) {
        return null
    }

    let startRow: number
    let endRow: number
    let startCol: number
    let endCol: number
    if (direction === 'down') {
        startRow = sourceRange.endRow + 1
        endRow = destRange.endRow
        startCol = sourceRange.startCol
        endCol = sourceRange.endCol
    } else {
        startRow = sourceRange.startRow
        endRow = sourceRange.endRow
        startCol = sourceRange.endCol + 1
        endCol = destRange.endCol
    }
    if (startRow > endRow || startCol > endCol) return null

    const left = colOffsets[startCol - 1] ?? 0
    const right = colOffsets[endCol] ?? left
    const width = right - left
    if (width <= 0) return null
    const top = rowOffsets[startRow - 1] ?? 0
    const bottom = rowOffsets[endRow] ?? top
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
                borderStyle: 'dashed',
                borderColor: '#22a06b',
                backgroundColor: 'rgba(34, 160, 107, 0.10)',
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

interface SelectionHandleOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
    readOnly: boolean
}

// HANDLE_SIZE is the visible square the user grabs. HIT_SLOP enlarges
// the touch target without growing the visible affordance — a 16px
// total tap area on every side keeps fat-finger touches reliable on
// mobile while the visible dot stays compact.
const HANDLE_SIZE = 8
const HIT_SLOP = 12

// SelectionHandleOverlay renders the small drag dot at the bottom-
// right of the current selection (anchor or range). Drag — by mouse
// or touch — fills a series across the new cells (the classic
// spreadsheet "fill handle"): pattern detection runs on the source,
// projection writes per-cell, and the post-fill selection covers the
// extended rectangle.
//
// Web escape hatch: holding shift while dragging routes the gesture
// to extendSelectionTo instead of fillDragMove. This preserves the
// pre-fill drag-to-extend behavior for the rare case where the user
// wants to grow the selection without filling. Modifier state is
// re-checked on each pointermove (PointerEvent carries shiftKey on
// web), so releasing/pressing shift mid-drag flips the mode for the
// next move. Native has no shift key — touch users always get fill;
// "Extend selection to here" lives in the long-press cell context
// menu as the touch-side fallback.
//
// Hidden during edit sessions so the dot doesn't sit on top of the
// CellEditor's caret. Hidden in readOnly mode since there's no
// meaningful gesture there.
//
// Web vs. native: PointerEvents on web (RN-Web's PanResponder is
// unreliable for mouse-only gestures), PanResponder on native.
// Mirrors the dual-mode pattern used by useColumnResize.
export function SelectionHandleOverlay({
    colOffsets,
    rowOffsets,
    readOnly,
}: SelectionHandleOverlayProps) {
    const selected = useGridStore(s => (s.editSession == null ? s.selected : null))
    const range = useGridStore(s => (s.editSession == null ? s.selectionRange : null))
    const store = useGridStoreApi()

    // Drag origin captured at gesture start. Refs (not state) so
    // every pixel of drag doesn't trigger a re-render that would
    // break the gesture mid-move.
    const startGridX = useRef(0)
    const startGridY = useRef(0)
    const startClientX = useRef(0)
    const startClientY = useRef(0)

    // captureStart records the grid-space origin of this drag —
    // shared between the web pointer-down and the native PanResponder
    // grant callbacks so the move math is identical on both
    // platforms. Returns false when there's nothing to drag from
    // (no selection); callers should bail without bootstrapping any
    // listeners.
    const captureStart = (clientX: number, clientY: number) => {
        const s = store.getState()
        const anchor = s.selected
        const r = s.selectionRange
        if (anchor == null) return false
        const endCol = r?.endCol ?? anchor.col
        const endRow = r?.endRow ?? anchor.row
        startGridX.current = colOffsets[endCol] ?? 0
        startGridY.current = rowOffsets[endRow] ?? 0
        startClientX.current = clientX
        startClientY.current = clientY
        return true
    }

    const handleMove = (clientX: number, clientY: number, shiftKey: boolean) => {
        const dx = clientX - startClientX.current
        const dy = clientY - startClientY.current
        const gridX = startGridX.current + dx
        const gridY = startGridY.current + dy
        const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
        if (target == null) return
        if (shiftKey) {
            store.getState().extendSelectionTo(target)
            return
        }
        store.getState().fillDragMove(target)
    }

    // Always call fillDragEnd on release so a shift-only drag (which
    // bootstrapped fillDrag in captureStart but never moved past the
    // source via fillDragMove) doesn't leave stale fillDrag state in
    // the store. The store's fillDragEnd no-ops cleanly when destRange
    // equals sourceRange.
    const handleEnd = () => {
        store.getState().fillDragEnd()
    }

    // Native: PanResponder, since touch gestures route through it
    // reliably on iOS/Android. PageX/Y is screen-space; we use it
    // the same way as the web clientX/Y branch. Touch always drives
    // fill — no shift key on a touchscreen, and the "extend
    // selection" fallback lives in the long-press cell context menu.
    //
    // Recreated per render rather than memoized — the overlay only
    // mounts when a selection exists (rare event).
    const panHandlers = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => {
            const { pageX, pageY } = e.nativeEvent
            if (!captureStart(pageX, pageY)) return
            if (!store.getState().fillDragStart()) return
        },
        onPanResponderMove: e => {
            const { pageX, pageY } = e.nativeEvent
            handleMove(pageX, pageY, false)
        },
        onPanResponderRelease: () => handleEnd(),
        onPanResponderTerminate: () => handleEnd(),
        onPanResponderTerminationRequest: () => false,
    }).panHandlers

    // Web: drag-detection via the underlying View's onMouseDown (the
    // earliest event we can hook before any focus shift), plus
    // document-level pointer listeners for the duration of the drag.
    // RN-Web doesn't reliably surface raw onPointerDown/Move/Up to
    // user props on a Pressable child, and onPressIn (RN-Web's
    // press-start equivalent) interferes with the click-away commit
    // path used elsewhere — so mousedown is the safe wiring point.
    // Document listeners always fire regardless of any responder
    // claims, and they self-clean on pointerup or pointercancel.
    const onMouseDown = (e: {
        button?: number
        clientX?: number
        clientY?: number
        preventDefault: () => void
        stopPropagation: () => void
    }) => {
        if (Platform.OS !== 'web') return
        if (typeof document === 'undefined') return
        if (e.button != null && e.button !== 0) return
        // Stop the cell underneath from also starting a drag-select.
        e.preventDefault()
        e.stopPropagation()
        const clientX = typeof e.clientX === 'number' ? e.clientX : 0
        const clientY = typeof e.clientY === 'number' ? e.clientY : 0
        if (!captureStart(clientX, clientY)) return
        // Bootstrap the fill drag eagerly. If the selection is empty
        // (the only way fillDragStart returns false), bail entirely
        // so we don't leak document listeners. Shift-drag-extend is
        // the escape hatch ON TOP of an active fill — without a
        // fillDragStart, there's nothing to extend either.
        if (!store.getState().fillDragStart()) return
        const onMove = (ev: PointerEvent) => handleMove(ev.clientX, ev.clientY, ev.shiftKey)
        const cleanup = () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', cleanup)
            document.removeEventListener('pointercancel', cleanup)
            handleEnd()
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', cleanup)
        document.addEventListener('pointercancel', cleanup)
    }

    if (selected == null || readOnly) return null

    const endCol = range?.endCol ?? selected.col
    const endRow = range?.endRow ?? selected.row
    const right = colOffsets[endCol] ?? 0
    const bottom = rowOffsets[endRow] ?? 0
    if (right <= 0 || bottom <= 0) return null

    // Center the handle on the bottom-right corner of the bottom-
    // right cell. The hitSlop expands the touch target invisibly so
    // touch users get a comfortable grab area.
    const left = right - HANDLE_SIZE / 2
    const top = bottom - HANDLE_SIZE / 2

    return (
        <Pressable
            accessibilityLabel="Selection handle"
            hitSlop={HIT_SLOP}
            style={
                {
                    position: 'absolute',
                    left,
                    top,
                    width: HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    backgroundColor: '#22a06b',
                    borderWidth: 1,
                    borderColor: '#ffffff',
                    // Web-only cursor affordance — RN-Web forwards
                    // unknown style keys to inline CSS. Native has no
                    // cursor concept; the hit slop carries discovery
                    // there.
                    ...(Platform.OS === 'web' ? { cursor: 'crosshair' } : null),
                    // biome-ignore lint/suspicious/noExplicitAny: web-only cursor key on RN ViewStyle
                } as any
            }
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...({ onMouseDown } as any)}
            {...panHandlers}
        />
    )
}
