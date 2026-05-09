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
import type * as Y from 'yjs'
import { type RemotePresence, usePresence } from '../hooks/use-presence'
import { useWorkbook } from '../hooks/use-workbook-context'
import { setYCell, setYCellStyle, useYCell } from '../hooks/use-y-cell'
import { type SheetWithId, useYSheets } from '../hooks/use-y-sheets'
import { columnLabel, formatCell } from '../lib/workbook-types'
import { yCellKey } from '../lib/y-cell-key'
import { CELLS_MAP, readStyleFromYMap } from '../lib/y-doc-bootstrap'
import { FormulaBar } from './FormulaBar'
import { Toolbar } from './Toolbar'

const CELL_WIDTH = 96
const CELL_HEIGHT = 28
const ROW_HEADER_WIDTH = 48
const HEADER_HEIGHT = CELL_HEIGHT
const OVERSCAN = 4
const MIN_ROWS = 50
const MIN_COLS = 26

// Inset shadow applied to the active row/column header cell on top of
// the bg-accent fill. Two paired insets produce a "pressed" look — a
// dim top-left edge plus a slightly brighter bottom-right edge, like
// the cell is sunken into the toolbar. RN-Web compiles boxShadow to
// CSS; on native, `style.boxShadow` is ignored gracefully (the bg +
// bold text already convey the active state without it).
const ACTIVE_HEADER_INSET_STYLE = {
    boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.18), inset -1px -1px 0 rgba(255,255,255,0.18)',
} as const

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

interface EditSession {
    row: number
    col: number
    draft: string
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
    // editSession unifies "which cell is being edited" + "its in-progress
    // draft". Lifted to Grid so the in-cell editor and the formula bar
    // share one source of truth — typing in either updates the same
    // draft and peer awareness, and one Enter/blur commits both views.
    const [editSession, setEditSession] = useState<EditSession | null>(null)

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
            setEditSession(null)
            publishLocal({ selection: cell, editing: null })
        },
        [publishLocal]
    )

    const onEditCell = useCallback(
        (cell: SelectedCell, initialDraft = '') => {
            if (readOnly) return
            setSelected(cell)
            setEditSession({ row: cell.row, col: cell.col, draft: initialDraft })
            publishLocal({
                selection: cell,
                editing: { row: cell.row, col: cell.col, draft: initialDraft },
            })
        },
        [readOnly, publishLocal]
    )

    const onEditDraftChange = useCallback(
        (row: number, col: number, draft: string) => {
            setEditSession({ row, col, draft })
            publishLocal({ selection: { row, col }, editing: { row, col, draft } })
        },
        [publishLocal]
    )

    const onCommitEdit = useCallback(
        (row: number, col: number, value: string) => {
            if (readOnly) {
                setEditSession(null)
                publishLocal({ selection: { row, col }, editing: null })
                return
            }
            setYCell(doc, sheetId, row, col, value)
            setEditSession(null)
            publishLocal({ selection: { row, col }, editing: null })
        },
        [doc, sheetId, readOnly, publishLocal]
    )

    const onCancelEdit = useCallback(() => {
        const cell = selected
        setEditSession(null)
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

    const onToggleItalic = useCallback(() => {
        if (selected == null || readOnly) return
        const current = readCellStyle(doc, sheetId, selected.row, selected.col)
        const nextItalic = current?.font?.italic !== true
        setYCellStyle(doc, sheetId, selected.row, selected.col, { font: { italic: nextItalic } })
    }, [doc, sheetId, selected, readOnly])

    // Subscribe to the selected cell so the toolbar's active state and
    // the formula bar's value re-render when the cell changes (locally
    // or via a peer). Passing null row/col would force useYCell to
    // observe a synthetic key — instead we early-out via doc==null when
    // there's no selection by keying the call on row/col 0,0 and
    // treating the result as "no selection" downstream.
    const selectedCellValue = useYCell(doc, sheetId, selected?.row ?? 0, selected?.col ?? 0)
    const isBold = selected != null && selectedCellValue?.style?.font?.bold === true
    const isItalic = selected != null && selectedCellValue?.style?.font?.italic === true

    // The formula bar shows the user-input form when typing (the
    // editSession draft), the formula text for formula cells, or the
    // displayed value otherwise. For formula cells we surface the
    // expression rather than the cached result so editing a formula
    // round-trips its formula text.
    const formulaBarValue = computeFormulaBarValue(editSession, selectedCellValue, selected != null)
    const formulaBarLabel = selected != null ? `${columnLabel(selected.col)}${selected.row}` : null

    const onFormulaChange = useCallback(
        (next: string) => {
            if (selected == null || readOnly) return
            // First keystroke into the formula bar implicitly opens an
            // edit session — there's no "click to edit" step in the
            // formula bar UX. Subsequent keystrokes update the same
            // draft and propagate to peers via awareness.
            onEditDraftChange(selected.row, selected.col, next)
        },
        [selected, readOnly, onEditDraftChange]
    )

    const onFormulaCommit = useCallback(() => {
        if (editSession == null) return
        onCommitEdit(editSession.row, editSession.col, editSession.draft)
    }, [editSession, onCommitEdit])

    const onFormulaCancel = useCallback(() => {
        onCancelEdit()
    }, [onCancelEdit])

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
            setEditSession(null)
            publishLocal({ selection: { row, col }, editing: null })
            setContextTarget({ cell: { row, col }, cursor: { x, y } })
        },
        [publishLocal]
    )

    const closeContextMenu = useCallback(() => setContextTarget(null), [])

    return (
        <View className="flex-1 bg-background">
            <Toolbar
                disabled={readOnly || selected == null}
                isBold={isBold}
                isItalic={isItalic}
                onToggleBold={onToggleBold}
                onToggleItalic={onToggleItalic}
            />
            <FormulaBar
                cellLabel={formulaBarLabel}
                value={formulaBarValue}
                disabled={readOnly || selected == null}
                onChange={onFormulaChange}
                onCommit={onFormulaCommit}
                onCancel={onFormulaCancel}
            />
            <View className="flex-row">
                <CornerCell />
                <ColumnHeader
                    scrollRef={headerScrollRef}
                    contentWidth={contentWidth}
                    firstCol={visible.firstCol}
                    lastCol={visible.lastCol}
                    activeCol={selected?.col ?? null}
                />
            </View>
            <View className="flex-1 flex-row">
                <RowHeader
                    scrollRef={leftColumnScrollRef}
                    contentHeight={contentHeight}
                    firstRow={visible.firstRow}
                    lastRow={visible.lastRow}
                    activeRow={selected?.row ?? null}
                />
                <Body
                    horizontalRef={horizontalRef}
                    verticalRef={verticalRef}
                    contentWidth={contentWidth}
                    contentHeight={contentHeight}
                    visible={visible}
                    sheet={sheet}
                    selected={selected}
                    editSession={editSession}
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
            <CellContextMenu target={contextTarget} doc={doc} sheetId={sheetId} onClose={closeContextMenu} />
        </View>
    )
})

// computeFormulaBarValue picks the right text to display in the
// formula bar:
//   - while editing, show the in-progress draft
//   - for formula cells, show the formula expression (so editing
//     round-trips the formula text rather than its cached result)
//   - otherwise, show the same string the cell renders
function computeFormulaBarValue(
    editSession: EditSession | null,
    cell: ReturnType<typeof useYCell>,
    hasSelection: boolean
): string {
    if (editSession != null) return editSession.draft
    if (!hasSelection || cell == null) return ''
    if (cell.kind === 'formula' && cell.formula) {
        return cell.formula
    }
    return formatCell(cell.kind, cell.raw, cell.formula)
}

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
    activeCol: number | null
}

function ColumnHeader({ scrollRef, contentWidth, firstCol, lastCol, activeCol }: ColumnHeaderProps) {
    const cells: React.ReactNode[] = []
    for (let col = firstCol; col <= lastCol; col++) {
        const isActive = col === activeCol
        cells.push(
            <View
                key={col}
                className={`border-r border-b border-border items-center justify-center ${
                    isActive ? 'bg-accent' : 'bg-surface-secondary'
                }`}
                style={{
                    position: 'absolute',
                    left: (col - 1) * CELL_WIDTH,
                    top: 0,
                    width: CELL_WIDTH,
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
    activeRow: number | null
}

function RowHeader({ scrollRef, contentHeight, firstRow, lastRow, activeRow }: RowHeaderProps) {
    const cells: React.ReactNode[] = []
    for (let row = firstRow; row <= lastRow; row++) {
        const isActive = row === activeRow
        cells.push(
            <View
                key={row}
                className={`border-r border-b border-border items-center justify-center ${
                    isActive ? 'bg-accent' : 'bg-surface-secondary'
                }`}
                style={{
                    position: 'absolute',
                    left: 0,
                    top: (row - 1) * CELL_HEIGHT,
                    width: ROW_HEADER_WIDTH,
                    height: CELL_HEIGHT,
                    ...(isActive ? ACTIVE_HEADER_INSET_STYLE : null),
                }}
            >
                <Text
                    className={`text-xs ${isActive ? 'text-accent-foreground' : 'text-muted-foreground'}`}
                    style={isActive ? { fontWeight: 'bold' } : undefined}
                >
                    {row}
                </Text>
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
    editSession: EditSession | null
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
    editSession,
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
                const isEditing = editSession?.row === row && editSession?.col === col
                const isSelected = selected?.row === row && selected?.col === col
                const remoteEditor = remoteEditingByCell.get(`${row}:${col}`) ?? null
                // editingDraft is only passed to the cell that owns the
                // edit session — this keeps Cell.memo equality stable
                // for non-editing cells (passing the draft to every
                // cell would invalidate every memoization on each
                // keystroke).
                const editingDraft = isEditing ? editSession.draft : ''
                cells.push(
                    <Cell
                        key={`${row}:${col}`}
                        sheetId={sheetId}
                        row={row}
                        col={col}
                        isSelected={isSelected}
                        isEditing={isEditing}
                        editingDraft={editingDraft}
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
        selected != null && editSession == null ? (
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
    editingDraft: string
    remoteEditor: RemotePresence | null
    onSelect: (cell: SelectedCell) => void
    onEdit: (cell: SelectedCell, initialDraft?: string) => void
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
    editingDraft,
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
    // formatCell is the single source of truth for the visible string;
    // `display` on disk is still maintained as a cache for old peers
    // and the server-side serializer, but the live render computes from
    // (kind, raw) so future formatting (Phase 3 numFmt) lights up here
    // automatically.
    const display = cellValue == null ? '' : formatCell(cellValue.kind, cellValue.raw, cellValue.formula)
    // Editing a formula cell should preload the formula expression
    // (e.g. "=SUM(A1:A2)"), not its computed result. This matches how
    // the formula bar surfaces formula text and lets users round-trip
    // a formula edit without losing the expression.
    const editDraft = cellValue?.kind === 'formula' && cellValue.formula ? cellValue.formula : display

    const remoteDraft = remoteEditor?.editing?.draft

    const left = (col - 1) * CELL_WIDTH
    const top = (row - 1) * CELL_HEIGHT

    if (isEditing) {
        return (
            <CellEditor
                left={left}
                top={top}
                value={editingDraft}
                onDraftChange={(draft) => onEditDraftChange(row, col, draft)}
                onCommit={(value) => onCommitEdit(row, col, value)}
                onCancel={onCancelEdit}
            />
        )
    }

    const onPress = () => {
        if (isSelected) {
            onEdit({ row, col }, editDraft)
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
            accessibilityLabel={`Cell ${columnLabel(col)}${row}`}
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
    value: string
    onDraftChange: (draft: string) => void
    onCommit: (value: string) => void
    onCancel: () => void
}

function CellEditor({ left, top, value, onDraftChange, onCommit, onCancel }: CellEditorProps) {
    // Fully controlled — Grid owns the draft state in editSession so
    // the formula bar and the in-cell editor stay synchronized.
    // Awareness publishing flows up through onDraftChange.
    return (
        <TextInput
            autoFocus
            value={value}
            onChangeText={onDraftChange}
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
            if (targetNode && node?.contains(targetNode)) return
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
