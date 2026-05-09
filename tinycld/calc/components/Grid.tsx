import { Menu, Separator } from '@tinycld/core/ui/menu'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
    type GestureResponderEvent,
    type LayoutChangeEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native'
import * as Y from 'yjs'
import { type RemotePresence, usePresence } from '../hooks/use-presence'
import { useWorkbook } from '../hooks/use-workbook-context'
import { setYCell, setYCellStyle, useYCell } from '../hooks/use-y-cell'
import { type SheetWithId, useYSheets } from '../hooks/use-y-sheets'
import { columnLabel } from '../lib/workbook-types'
import { yCellKey } from '../lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../lib/y-doc-bootstrap'

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
    sheetId: string
    minRows?: number
    minCols?: number
    readOnly?: boolean
}

interface SelectedCell {
    row: number
    col: number
}

interface Viewport {
    scrollX: number
    scrollY: number
    width: number
    height: number
}

export const Grid = forwardRef<GridHandle, GridProps>(function Grid(
    { sheetId, minRows = MIN_ROWS, minCols = MIN_COLS, readOnly = false },
    ref
) {
    const { doc, awareness } = useWorkbook()
    const sheets = useYSheets(doc)
    const sheet = sheets.find((s) => s.id === sheetId) ?? null

    const rows = Math.max(sheet?.rowCount ?? 0, minRows)
    const cols = Math.max(sheet?.colCount ?? 0, minCols)

    const contentWidth = cols * CELL_WIDTH
    const contentHeight = rows * CELL_HEIGHT

    // Viewport metrics: scroll position and measured size collapsed
    // into a single state so changes don't fan out into 4 separate
    // setState round-trips per scroll/layout event.
    const [viewport, setViewport] = useState<Viewport>({
        scrollX: 0,
        scrollY: 0,
        width: 0,
        height: 0,
    })

    const [selected, setSelected] = useState<SelectedCell | null>(null)
    const [editingCell, setEditingCell] = useState<SelectedCell | null>(null)

    // publishLocal writes the consumer-shaped awareness slot. Called
    // by every handler that changes selection/editing rather than via
    // a sync-via-effect: pairing useState with useEffect to mirror
    // state into Awareness is the exact anti-pattern CLAUDE.md flags
    // ("if you find yourself pairing useState with useEffect to sync
    // or transform data…").
    const publishLocal = useCallback(
        (next: { selection: SelectedCell | null; editing: { row: number; col: number; draft: string } | null }) => {
            const local = awareness.getLocalState() ?? {}
            awareness.setLocalState({
                ...local,
                sheetId,
                selection: next.selection,
                editing: next.editing,
            })
        },
        [awareness, sheetId]
    )

    const onSelectCell = useCallback(
        (cell: SelectedCell) => {
            setSelected(cell)
            setEditingCell(null)
            publishLocal({ selection: cell, editing: null })
        },
        [publishLocal]
    )

    const onEditCell = useCallback(
        (cell: SelectedCell) => {
            if (readOnly) return
            setSelected(cell)
            setEditingCell(cell)
            publishLocal({
                selection: cell,
                editing: { row: cell.row, col: cell.col, draft: '' },
            })
        },
        [readOnly, publishLocal]
    )

    const onEditDraftChange = useCallback(
        (row: number, col: number, draft: string) => {
            publishLocal({ selection: { row, col }, editing: { row, col, draft } })
        },
        [publishLocal]
    )

    const onCommitEdit = useCallback(
        (row: number, col: number, value: string) => {
            if (readOnly) {
                setEditingCell(null)
                publishLocal({ selection: { row, col }, editing: null })
                return
            }
            setYCell(doc, sheetId, row, col, value)
            setEditingCell(null)
            publishLocal({ selection: { row, col }, editing: null })
        },
        [doc, sheetId, readOnly, publishLocal]
    )

    const onCancelEdit = useCallback(() => {
        const cell = selected
        setEditingCell(null)
        publishLocal({ selection: cell, editing: null })
    }, [selected, publishLocal])

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
        if (viewport.width === 0 || viewport.height === 0) {
            return { firstRow: 1, lastRow: 0, firstCol: 1, lastCol: 0 }
        }
        const firstRow = Math.max(1, Math.floor(viewport.scrollY / CELL_HEIGHT) + 1 - OVERSCAN)
        const lastRow = Math.min(rows, Math.ceil((viewport.scrollY + viewport.height) / CELL_HEIGHT) + OVERSCAN)
        const firstCol = Math.max(1, Math.floor(viewport.scrollX / CELL_WIDTH) + 1 - OVERSCAN)
        const lastCol = Math.min(cols, Math.ceil((viewport.scrollX + viewport.width) / CELL_WIDTH) + OVERSCAN)
        return { firstRow, lastRow, firstCol, lastCol }
    }, [viewport, rows, cols])

    const onHorizontalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x
        setViewport((v) => (v.scrollX === x ? v : { ...v, scrollX: x }))
        // Mirror to the column header so it stays aligned with the body.
        // Using a ref + scrollTo (rather than absolute-positioning the
        // header inside the body's content) keeps the header in its own
        // sticky region so it doesn't get clipped by row windowing.
        headerScrollRef.current?.scrollTo({ x, animated: false })
    }, [])

    const onVerticalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y
        setViewport((v) => (v.scrollY === y ? v : { ...v, scrollY: y }))
        leftColumnScrollRef.current?.scrollTo({ y, animated: false })
    }, [])

    const onBodyLayout = useCallback((e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout
        setViewport((v) => (v.width === width && v.height === height ? v : { ...v, width, height }))
    }, [])

    const presence = usePresence(awareness)
    const presenceOnSheet = useMemo(() => presence.filter((p) => p.sheetId === sheetId), [presence, sheetId])

    const onToggleBold = useCallback(() => {
        if (selected == null || readOnly) return
        const current = readCellStyle(doc, sheetId, selected.row, selected.col)
        const nextBold = current?.font?.bold !== true
        setYCellStyle(doc, sheetId, selected.row, selected.col, { font: { bold: nextBold } })
    }, [doc, sheetId, selected, readOnly])

    // Single Menu mount per Grid. The right-clicked / long-pressed cell
    // is captured via a callback dispatched up from Cell, and the Menu
    // is positioned at the cursor/touch coordinates via triggerPosition.
    // This avoids per-cell <Menu> mounts (which would break <Cell>'s
    // memoization and balloon DOM nodes in a windowed grid).
    const [contextTarget, setContextTarget] = useState<{
        cell: SelectedCell
        cursor: { x: number; y: number }
    } | null>(null)

    const onCellContextMenu = useCallback(
        (row: number, col: number, x: number, y: number) => {
            // Match single-click behaviour: a context-menu gesture also
            // selects the cell. Skip edit so the menu doesn't open over
            // a TextInput.
            setSelected({ row, col })
            setEditingCell(null)
            publishLocal({ selection: { row, col }, editing: null })
            setContextTarget({ cell: { row, col }, cursor: { x, y } })
        },
        [publishLocal]
    )

    const closeContextMenu = useCallback(() => setContextTarget(null), [])

    return (
        <View className="flex-1 bg-background">
            <Toolbar disabled={readOnly || selected == null} onToggleBold={onToggleBold} />
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
                    editingCell={editingCell}
                    presenceOnSheet={presenceOnSheet}
                    onSelect={onSelectCell}
                    onEdit={onEditCell}
                    onEditDraftChange={onEditDraftChange}
                    onCommitEdit={onCommitEdit}
                    onCancelEdit={onCancelEdit}
                    onLayout={onBodyLayout}
                    onHorizontalScroll={onHorizontalScroll}
                    onVerticalScroll={onVerticalScroll}
                    onCellContextMenu={readOnly ? undefined : onCellContextMenu}
                />
            </View>
            <CellContextMenu
                target={contextTarget}
                doc={doc}
                sheetId={sheetId}
                onClose={closeContextMenu}
            />
        </View>
    )
})

// readCellStyle is a one-shot read of a cell's style from the Y.Doc.
// Used by handlers that need the current value to compute a toggle —
// can't use the useYCell hook from inside a callback, and subscribing
// the whole Grid to every cell change just to know whether bold is on
// would be wasteful.
function readCellStyle(doc: Y.Doc | null, sheetId: string, row: number, col: number) {
    if (doc == null) return undefined
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return undefined
    return readStyleFromYMap(cell)
}

interface ToolbarProps {
    disabled: boolean
    onToggleBold: () => void
}

function Toolbar({ disabled, onToggleBold }: ToolbarProps) {
    return (
        <View className="flex-row items-center bg-surface-secondary border-b border-border" style={{ height: 32, paddingHorizontal: 4 }}>
            <Pressable
                onPress={onToggleBold}
                disabled={disabled}
                className="items-center justify-center"
                style={{ width: 28, height: 24, opacity: disabled ? 0.4 : 1 }}
            >
                <Text className="text-foreground" style={{ fontWeight: 'bold' }}>
                    B
                </Text>
            </Pressable>
        </View>
    )
}

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
    sheet: SheetWithId | null
    selected: SelectedCell | null
    editingCell: SelectedCell | null
    presenceOnSheet: RemotePresence[]
    onSelect: (cell: SelectedCell) => void
    onEdit: (cell: SelectedCell) => void
    onEditDraftChange: (row: number, col: number, draft: string) => void
    onCommitEdit: (row: number, col: number, value: string) => void
    onCancelEdit: () => void
    onLayout: (e: LayoutChangeEvent) => void
    onHorizontalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onVerticalScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
    onCellContextMenu?: (row: number, col: number, x: number, y: number) => void
}

function Body({
    horizontalRef,
    verticalRef,
    contentWidth,
    contentHeight,
    visible,
    sheet,
    selected,
    editingCell,
    presenceOnSheet,
    onSelect,
    onEdit,
    onEditDraftChange,
    onCommitEdit,
    onCancelEdit,
    onLayout,
    onHorizontalScroll,
    onVerticalScroll,
    onCellContextMenu,
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
            for (let col = visible.firstCol; col <= visible.lastCol; col++) {
                const isEditing = editingCell?.row === row && editingCell?.col === col
                const isSelected = selected?.row === row && selected?.col === col
                const remoteEditor = remoteEditingByCell.get(`${row}:${col}`) ?? null
                cells.push(
                    <Cell
                        key={`${row}:${col}`}
                        sheetId={sheetId}
                        row={row}
                        col={col}
                        isSelected={isSelected}
                        isEditing={isEditing}
                        remoteEditor={remoteEditor}
                        onSelect={onSelect}
                        onEdit={onEdit}
                        onEditDraftChange={onEditDraftChange}
                        onCommitEdit={onCommitEdit}
                        onCancelEdit={onCancelEdit}
                        onContextMenu={onCellContextMenu}
                    />
                )
            }
        }
    }

    const localSelectionOverlay =
        selected != null && editingCell == null ? (
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

    const remoteOverlays = presenceOnSheet.flatMap((p) => {
        const out: React.ReactNode[] = []
        if (p.selection != null && p.editing == null) {
            out.push(
                <RemoteSelectionOverlay
                    key={`sel-${p.clientID}`}
                    row={p.selection.row}
                    col={p.selection.col}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
        if (p.editing != null) {
            out.push(
                <RemoteSelectionOverlay
                    key={`edit-${p.clientID}`}
                    row={p.editing.row}
                    col={p.editing.col}
                    color={p.user.color}
                    name={p.user.name}
                />
            )
        }
        return out
    })

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
                    {remoteOverlays}
                    {localSelectionOverlay}
                </ScrollView>
            </ScrollView>
        </View>
    )
}

interface CellProps {
    sheetId: string
    row: number
    col: number
    isSelected: boolean
    isEditing: boolean
    remoteEditor: RemotePresence | null
    onSelect: (cell: SelectedCell) => void
    onEdit: (cell: SelectedCell) => void
    onEditDraftChange: (row: number, col: number, draft: string) => void
    onCommitEdit: (row: number, col: number, value: string) => void
    onCancelEdit: () => void
    onContextMenu?: (row: number, col: number, x: number, y: number) => void
}

const Cell = memo(function Cell({
    sheetId,
    row,
    col,
    isSelected,
    isEditing,
    remoteEditor,
    onSelect,
    onEdit,
    onEditDraftChange,
    onCommitEdit,
    onCancelEdit,
    onContextMenu,
}: CellProps) {
    const { doc } = useWorkbook()
    const cellValue = useYCell(doc, sheetId, row, col)
    const display = cellValue?.display ?? ''

    const remoteDraft = remoteEditor?.editing?.draft

    const left = (col - 1) * CELL_WIDTH
    const top = (row - 1) * CELL_HEIGHT

    if (isEditing) {
        return (
            <CellEditor
                left={left}
                top={top}
                initial={display}
                onDraftChange={(draft) => onEditDraftChange(row, col, draft)}
                onCommit={(value) => onCommitEdit(row, col, value)}
                onCancel={onCancelEdit}
            />
        )
    }

    const onPress = () => {
        if (isSelected) {
            onEdit({ row, col })
        } else {
            onSelect({ row, col })
        }
    }

    // Native long-press fires before any subsequent onPress is dispatched,
    // so wiring the context menu here doesn't conflict with the
    // select-then-edit gesture above. Web uses onContextMenu (right-click)
    // via a DOM prop the RN-Web Pressable forwards but doesn't type.
    const onLongPress = onContextMenu
        ? (e: GestureResponderEvent) => {
              const { pageX, pageY } = e.nativeEvent
              onContextMenu(row, col, pageX, pageY)
          }
        : undefined

    const webContextMenuProp =
        Platform.OS === 'web' && onContextMenu
            ? {
                  onContextMenu: (e: { preventDefault: () => void; clientX: number; clientY: number }) => {
                      e.preventDefault()
                      onContextMenu(row, col, e.clientX, e.clientY)
                  },
              }
            : null

    const showRemoteDraft = remoteDraft != null
    const textColor = showRemoteDraft ? remoteEditor?.user.color : undefined
    const isBold = cellValue?.style?.font?.bold === true
    const isItalic = cellValue?.style?.font?.italic === true

    const textStyle = showRemoteDraft
        ? {
              color: textColor,
              fontStyle: 'italic' as const,
              fontWeight: isBold ? ('bold' as const) : undefined,
          }
        : {
              fontWeight: isBold ? ('bold' as const) : undefined,
              fontStyle: isItalic ? ('italic' as const) : undefined,
          }

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            style={{
                position: 'absolute',
                left,
                top,
                width: CELL_WIDTH,
                height: CELL_HEIGHT,
            }}
            className="border-r border-b border-border bg-background justify-center px-1"
            // biome-ignore lint/suspicious/noExplicitAny: web-only DOM event prop on RN Pressable
            {...((webContextMenuProp ?? {}) as any)}
        >
            <Text className="text-xs" numberOfLines={1} style={textStyle}>
                {showRemoteDraft ? remoteDraft : display}
            </Text>
        </Pressable>
    )
})

interface CellEditorProps {
    left: number
    top: number
    initial: string
    onDraftChange: (draft: string) => void
    onCommit: (value: string) => void
    onCancel: () => void
}

function CellEditor({ left, top, initial, onDraftChange, onCommit, onCancel }: CellEditorProps) {
    const [value, setValue] = useState(initial)

    // Publish keystrokes directly into local awareness via the
    // onDraftChange callback — no useEffect mirroring step. Awareness
    // encoding/transport is debounced upstream by y-protocols's
    // natural batching, so we don't add our own debounce here.
    const onChangeText = useCallback(
        (next: string) => {
            setValue(next)
            onDraftChange(next)
        },
        [onDraftChange]
    )

    return (
        <TextInput
            autoFocus
            value={value}
            onChangeText={onChangeText}
            onSubmitEditing={() => onCommit(value)}
            onBlur={() => onCommit(value)}
            onKeyPress={(e) => {
                // RN-Web surfaces Escape via onKeyPress; on native this
                // handler is a no-op for Escape (no hardware key), which
                // is fine — blur/Enter still commit.
                const key = (e.nativeEvent as { key?: string }).key
                if (key === 'Escape') {
                    onCancel()
                }
            }}
            style={{
                position: 'absolute',
                left,
                top,
                width: CELL_WIDTH,
                height: CELL_HEIGHT,
                paddingHorizontal: 4,
                fontSize: 12,
                borderWidth: 2,
                borderColor: '#22a06b',
            }}
            className="bg-background text-foreground"
        />
    )
}

interface RemoteSelectionOverlayProps {
    row: number
    col: number
    color: string
    name: string
}

function RemoteSelectionOverlay({ row, col, color, name }: RemoteSelectionOverlayProps) {
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left: (col - 1) * CELL_WIDTH,
                top: (row - 1) * CELL_HEIGHT,
                width: CELL_WIDTH,
                height: CELL_HEIGHT,
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

interface CellContextMenuProps {
    target: { cell: SelectedCell; cursor: { x: number; y: number } } | null
    doc: Y.Doc | null
    sheetId: string
    onClose: () => void
}

// Single Menu instance shared by every cell. Mounted in Grid so cells
// stay free of any per-cell Menu overhead. Positioned at the
// cursor/touch coordinates via Menu's triggerPosition prop (a 0×0
// "trigger rect" anchored at the click point produces a popover that
// drops down to the bottom-right of the cursor, with edge-flip handled
// by Menu.Content).
function CellContextMenu({ target, doc, sheetId, onClose }: CellContextMenuProps) {
    const contentRef = useRef<View | null>(null)

    // Web: dismiss on any pointerdown outside the menu content.
    // Mirrors the pattern in @tinycld/core/components/ContextMenu —
    // Gluestack's overlay scrim is unreliable for outside-click
    // dismissal (clicks can land on cells underneath).
    //
    // Native: a Pressable absolute-fill scrim inside Menu.Portal handles
    // taps outside; rendered conditionally below.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (target == null) return
        if (typeof document === 'undefined') return
        const handler = (event: PointerEvent) => {
            const targetNode = event.target as Node | null
            const node = contentRef.current as unknown as Node | null
            if (targetNode && node && node.contains(targetNode)) return
            onClose()
        }
        document.addEventListener('pointerdown', handler, true)
        return () => {
            document.removeEventListener('pointerdown', handler, true)
        }
    }, [target, onClose])

    const isOpen = target != null
    const triggerPos = target ? { x: target.cursor.x, y: target.cursor.y, width: 0, height: 0 } : null

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    const onClear = useCallback(() => {
        if (target == null || doc == null) return
        setYCell(doc, sheetId, target.cell.row, target.cell.col, '')
    }, [doc, sheetId, target])

    const onToggleBold = useCallback(() => {
        if (target == null || doc == null) return
        const current = readCellStyle(doc, sheetId, target.cell.row, target.cell.col)
        const nextBold = current?.font?.bold !== true
        setYCellStyle(doc, sheetId, target.cell.row, target.cell.col, { font: { bold: nextBold } })
    }, [doc, sheetId, target])

    const onToggleItalic = useCallback(() => {
        if (target == null || doc == null) return
        const current = readCellStyle(doc, sheetId, target.cell.row, target.cell.col)
        const nextItalic = current?.font?.italic !== true
        setYCellStyle(doc, sheetId, target.cell.row, target.cell.col, { font: { italic: nextItalic } })
    }, [doc, sheetId, target])

    const currentStyle = target ? readCellStyle(doc, sheetId, target.cell.row, target.cell.col) : undefined
    const isBold = currentStyle?.font?.bold === true
    const isItalic = currentStyle?.font?.italic === true

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    <Menu.Item onPress={onClear}>
                        <Menu.ItemTitle>Clear contents</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onToggleBold}>
                        <Menu.ItemTitle>{isBold ? 'Remove bold' : 'Bold'}</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onToggleItalic}>
                        <Menu.ItemTitle>{isItalic ? 'Remove italic' : 'Italic'}</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
