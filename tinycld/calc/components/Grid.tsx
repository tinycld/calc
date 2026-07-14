import { forwardRef, useCallback, useEffect, useMemo, useRef } from 'react'
import { type LayoutChangeEvent, Platform, View } from 'react-native'
import { useFindActions } from '../hooks/find/use-find-actions'
import { createFindStore } from '../hooks/find/use-find-store'
import { FindStoreProvider, useFindStoreApi } from '../hooks/find/use-find-store-context'
import { useCsvDownload } from '../hooks/grid/use-csv-download'
import { useGridColumnResize } from '../hooks/grid/use-grid-column-resize'
import { useGridFilterControls } from '../hooks/grid/use-grid-filter-controls'
import { useGridFormatControls } from '../hooks/grid/use-grid-format-controls'
import { useGridFormulaBar } from '../hooks/grid/use-grid-formula-bar'
import { useGridFreezeControls } from '../hooks/grid/use-grid-freeze-controls'
import { useGridPrintDialog } from '../hooks/grid/use-grid-print-dialog'
import { useGridRowResize } from '../hooks/grid/use-grid-row-resize'
import { type GridStoreInstance, useGridStoreInstance } from '../hooks/grid/use-grid-store-instance'
import { useGridSuggestions } from '../hooks/grid/use-grid-suggestions'
import { useGridToolbarActions } from '../hooks/grid/use-grid-toolbar-actions'
import { useGridToolbarToggles } from '../hooks/grid/use-grid-toolbar-toggles'
import { type GridViewportHandle, useGridViewport } from '../hooks/grid/use-grid-viewport'
import { useRefDragExtender } from '../hooks/grid/use-ref-drag-extender'
import { useCalcShortcuts } from '../hooks/use-calc-shortcuts'
import { useClearFormatting } from '../hooks/use-clear-formatting'
import { useClipboard } from '../hooks/use-clipboard'
import { useCommentShortcut } from '../hooks/use-comment-shortcut'
import { GridStoreProvider, useGridStore } from '../hooks/use-grid-store'
import { usePivotForSheet } from '../hooks/use-pivot-for-sheet'
import { usePresence } from '../hooks/use-presence'
import { createPrintDialogStore, PrintDialogProvider } from '../hooks/use-print-dialog'
import { useReactiveFilter } from '../hooks/use-reactive-filter'
import { useSheetActions } from '../hooks/use-sheet-actions'
import type { UndoManagerState } from '../hooks/use-undo-manager'
import { useWorkbook } from '../hooks/use-workbook-context'
import type { WorkbookFileActions } from '../hooks/use-workbook-file-actions'
import { useAllYSheets, useYSheets } from '../hooks/use-y-sheets'
import { classifyCellKey } from '../lib/cell-key-action'
import { rangeToSheetRelativeA1 } from '../lib/conditional-format/a1'
import { buildColOffsets, buildRowOffsets } from '../lib/dimensions'
import { buildA1Range } from '../lib/pivot/range-parse'
import {
    allRanges,
    computeShiftArrowTarget,
    primaryAnchor,
    primaryRange,
    unionBoundingBox,
} from '../lib/selection-range'
import { useConditionalFormatPanelStore } from '../lib/stores/conditional-format-panel-store'
import { useNamedRangesDialogStore } from '../lib/stores/named-ranges-dialog-store'
import { usePivotPanelStore } from '../lib/stores/pivot-panel-store'
import type { CellStyle } from '../lib/workbook-types'
import { CalcCommentDrawer } from './comments/CalcCommentDrawer'
import { ConditionalFormatPanel } from './conditional-format/ConditionalFormatPanel'
import { FindReplaceDialogGate } from './FindReplaceDialog'
import { FormulaBar } from './FormulaBar'
import { FormulaSuggestionList } from './FormulaSuggestionList'
import { Body } from './grid/Body'
import { CellContextMenu } from './grid/CellContextMenu'
import { ColumnHeader } from './grid/ColumnHeader'
import { CommentPopover } from './grid/CommentPopover'
import { CornerCell } from './grid/CornerCell'
import { MIN_COLS, MIN_ROWS } from './grid/constants'
import { FilterColumnDialog } from './grid/FilterColumnDialog'
import { GridCanvasTheme } from './grid/GridCanvasTheme'
import { HandleContextMenu } from './grid/HandleContextMenu'
import { HeaderContextMenu } from './grid/HeaderContextMenu'
import { RowHeader } from './grid/RowHeader'
import { autosizeCol, commitColWidth, commitRowHeight } from './grid/resize-actions'
import { SortDialog } from './grid/SortDialog'
import { applyFormatPainterToDest, readCellStyle } from './grid/style-helpers'
import { MenuBar } from './menubar/MenuBar'
import { NameBox } from './NameBox'
import { NamedRangesDialog } from './named-ranges/NamedRangesDialog'
import { PrintDialog } from './PrintDialog'
import { defaultTargetSheetName } from './pivot/new-pivot-dialog-helpers'
import { PivotGrid } from './pivot/PivotGrid'
import { SelectionStatusBanner } from './SelectionStatusBanner'
import { SortStatusBanner } from './SortStatusBanner'
import { Toolbar, type ToolbarProps } from './Toolbar'

export type GridHandle = GridViewportHandle

interface GridProps {
    sheetId: string
    // Drive_items.id of the workbook. Threaded comments are scoped to a
    // workbook (and within it, a cell on a sheet); the popover and
    // mutation hooks need this to insert/update calc_comments rows.
    driveItemId: string
    minRows?: number
    minCols?: number
    readOnly?: boolean
    // Comes from useUndoManager(doc) at the screen level so the
    // toolbar buttons and the Cmd-Z keyboard shortcuts share one
    // Y.UndoManager instance.
    undoState: UndoManagerState
    // Workbook display name; the File menu surfaces this via the
    // "Rename…" dialog and the "Make a copy" default value.
    workbookName: string
    // Drive-side actions (rename / duplicate / trash / open details)
    // resolved at the screen layer so Grid stays agnostic to drive's
    // hook signature.
    fileActions: WorkbookFileActions
    // Switches the workbook to a different sheet by id. The screen
    // owns the URL-as-source-of-truth pattern, so this routes through
    // `router.replace(orgHref('calc/[id]', { id, sheet: nextId }))`.
    // Used by the pivot-insert flow to jump to the freshly-created
    // pivot output sheet.
    onActivateSheet: (sheetId: string) => void
    // Opens the screen-level CommentDrawer. The screen mounts the
    // drawer itself; Grid only fires the toggle from the View menu.
    onShowComments: () => void
}

// Top-level Grid component. Builds the per-instance Zustand store
// (one per <Grid> mount, never a singleton — see grid-store.ts) and
// the two TextInput refs the store needs for focus management, then
// mounts a provider so descendants can subscribe via selectors.
//
// All other React state lives in focused sub-hooks invoked from
// GridInner: viewport, column/row resize, toolbar toggles, formula
// bar, suggestion popover, and the ref-drag extender effect. The
// orchestration here is intentionally thin — Grid is composition,
// not logic.
export const Grid = forwardRef<GridHandle, GridProps>(function Grid(
    {
        sheetId,
        driveItemId,
        minRows = MIN_ROWS,
        minCols = MIN_COLS,
        readOnly = false,
        undoState,
        workbookName,
        fileActions,
        onActivateSheet,
        onShowComments,
    },
    ref
) {
    const { doc, awareness } = useWorkbook()
    const instance = useGridStoreInstance({ doc, awareness, sheetId, readOnly })
    // One find store per workbook — kept stable across sheet switches
    // so the dialog (and any in-flight query) survives navigation.
    const findStore = useMemo(() => createFindStore(), [])
    // Per-Grid-instance print-dialog store. Matches find-store's
    // pattern; prevents a second concurrent Grid mount from sharing
    // dialog state.
    const printDialogStore = useMemo(() => createPrintDialogStore(), [])
    // Hook call order above must NOT change between renders. Branching
    // happens AFTER all hooks; the PivotGrid path skips the provider
    // tree entirely but the providers' stores have already been
    // initialized and simply have no subscribers, which is harmless.
    const pivotDef = usePivotForSheet(doc, sheetId)
    if (pivotDef != null && doc != null) {
        return (
            <PivotGrid
                doc={doc}
                def={pivotDef}
                sheetId={sheetId}
                onOpenSidePanel={() => usePivotPanelStore.getState().open(sheetId)}
                readOnly={readOnly}
            />
        )
    }
    return (
        <GridStoreProvider store={instance.store}>
            <FindStoreProvider store={findStore}>
                <PrintDialogProvider store={printDialogStore}>
                    <GridInner
                        sheetId={sheetId}
                        driveItemId={driveItemId}
                        minRows={minRows}
                        minCols={minCols}
                        readOnly={readOnly}
                        undoState={undoState}
                        instance={instance}
                        gridRef={ref}
                        workbookName={workbookName}
                        fileActions={fileActions}
                        onActivateSheet={onActivateSheet}
                        onShowComments={onShowComments}
                    />
                </PrintDialogProvider>
            </FindStoreProvider>
        </GridStoreProvider>
    )
})

interface GridInnerProps {
    sheetId: string
    driveItemId: string
    minRows: number
    minCols: number
    readOnly: boolean
    undoState: UndoManagerState
    instance: GridStoreInstance
    gridRef: React.ForwardedRef<GridHandle>
    workbookName: string
    fileActions: WorkbookFileActions
    onActivateSheet: (sheetId: string) => void
    onShowComments: () => void
}

function GridInner({
    sheetId,
    driveItemId,
    minRows,
    minCols,
    readOnly,
    undoState,
    instance,
    gridRef,
    workbookName,
    fileActions,
    onActivateSheet,
    onShowComments,
}: GridInnerProps) {
    const { doc, awareness } = useWorkbook()
    const sheets = useYSheets(doc)
    const sheet = sheets.find(s => s.id === sheetId) ?? null

    const rows = Math.max(sheet?.rowCount ?? 0, minRows)
    const cols = Math.max(sheet?.colCount ?? 0, minCols)

    // Prefix-sum offsets. colOffsets[c] is the LEFT edge of column
    // c+1 (so colOffsets[0]=0, colOffsets[cols]=contentWidth);
    // rowOffsets is the same on the Y axis. Reused by every position
    // lookup in render and recomputed only when colWidths/rowHeights
    // identity changes (which happens exactly when a peer or the
    // local user resizes — see useYSheets snapshot equality).
    const colOffsets = useMemo(
        () => buildColOffsets(cols, sheet?.colWidths),
        [cols, sheet?.colWidths]
    )
    const rowOffsets = useMemo(
        () => buildRowOffsets(rows, sheet?.rowHeights),
        [rows, sheet?.rowHeights]
    )
    const contentWidth = colOffsets[cols]
    const contentHeight = rowOffsets[rows]

    const frozenRows = sheet?.frozenRows ?? 0
    const frozenCols = sheet?.frozenCols ?? 0
    // useGridViewport binary-searches the visible window; it shifts the
    // lower bound by the frozen extent so the bottom-right quadrant
    // can't scroll an unfrozen cell behind the frozen one. Pass the
    // bare locals here rather than the freeze hook's bundle to keep
    // useGridFreezeControls focused on toolbar-side state.
    const viewport = useGridViewport({
        rows,
        cols,
        colOffsets,
        rowOffsets,
        handleRef: gridRef,
        frozenRows,
        frozenCols,
    })
    const colResize = useGridColumnResize({ doc, sheetId, sheet, readOnly })
    const rowResize = useGridRowResize({ doc, sheetId, sheet, readOnly })

    // Wire the viewport's scroll-to-visible into the store so keyboard
    // navigation (arrow keys, Enter) can bring the new cell into view.
    // Use a stable ref container so the effect only runs when the
    // offsets or the scroll refs change — not on every render.
    const scrollCtxRef = useRef({ colOffsets, rowOffsets, viewport })
    scrollCtxRef.current = { colOffsets, rowOffsets, viewport }
    useEffect(() => {
        instance.scrollToCellRef.current = (row: number, col: number) => {
            const { colOffsets: co, rowOffsets: ro, viewport: vp } = scrollCtxRef.current
            const snap = vp.snapshotRef.current
            const cellLeft = co[Math.max(0, col - 1)] ?? 0
            const cellRight = co[col] ?? cellLeft + 80
            const cellTop = ro[Math.max(0, row - 1)] ?? 0
            const cellBottom = ro[row] ?? cellTop + 24
            let newScrollX = snap.scrollX
            if (cellLeft < snap.scrollX) {
                newScrollX = cellLeft
            } else if (cellRight > snap.scrollX + snap.width) {
                newScrollX = Math.max(0, cellRight - snap.width)
            }
            let newScrollY = snap.scrollY
            if (cellTop < snap.scrollY) {
                newScrollY = cellTop
            } else if (cellBottom > snap.scrollY + snap.height) {
                newScrollY = Math.max(0, cellBottom - snap.height)
            }
            if (newScrollX !== snap.scrollX) {
                vp.horizontalRef.current?.scrollTo({ x: newScrollX, animated: false })
            }
            if (newScrollY !== snap.scrollY) {
                vp.verticalRef.current?.scrollTo({ y: newScrollY, animated: false })
            }
        }
    }, [instance.scrollToCellRef])

    // Focus sentinel: a zero-size focusable div (web only) that captures
    // keyboard events after editing ends. Without it, the TextInput unmounts
    // and DOM focus lands on the body — the next keystroke does nothing.
    const sentinelRef = useRef<View>(null)
    useEffect(() => {
        if (Platform.OS !== 'web') return
        instance.focusSentinelRef.current = () => {
            // RN-Web renders View as a focusable div; RN's View type has no
            // focus(), so narrow to the web-only method we call.
            ;(sentinelRef.current as { focus?: () => void } | null)?.focus?.()
        }
    }, [instance.focusSentinelRef])

    const onSentinelKeyDown = useCallback(
        (e: {
            key: string
            shiftKey: boolean
            metaKey: boolean
            ctrlKey: boolean
            altKey: boolean
            preventDefault: () => void
        }) => {
            if (readOnly) return
            const state = instance.store.getState()
            const anchor = primaryAnchor(state.selection)
            if (anchor == null) return
            const action = classifyCellKey(e)
            if (action.kind === 'ignore') return
            e.preventDefault()
            const maxRow = rows - 1
            const maxCol = cols - 1
            if (action.kind === 'arrow' || action.kind === 'navigate') {
                state.navigateSelection(action.direction, maxRow, maxCol)
                return
            }
            if (action.kind === 'extend') {
                const next = computeShiftArrowTarget(
                    state.selection,
                    action.direction,
                    anchor.row,
                    anchor.col,
                    maxRow,
                    maxCol
                )
                state.extendActiveRangeTo(next)
                return
            }
            if (action.kind === 'clear') {
                state.clearSelection()
                return
            }
            state.editCell({ row: anchor.row, col: anchor.col }, action.seed)
        },
        [instance.store, readOnly, rows, cols]
    )

    const presence = usePresence(awareness)
    const presenceOnSheet = useMemo(
        () => presence.filter(p => p.sheetId === sheetId),
        [presence, sheetId]
    )

    const isFormatPainterActive = useGridStore(s => s.formatPainterCells != null)

    const activateFormatPainter = useCallback(() => {
        if (readOnly || doc == null) return
        const state = instance.store.getState()
        if (state.formatPainterCells != null) {
            state.clearFormatPainter()
            return
        }
        const range = primaryRange(state.selection)
        if (range == null) return
        const cells: CellStyle[][] = []
        for (let r = range.startRow; r <= range.endRow; r++) {
            const row: CellStyle[] = []
            for (let c = range.startCol; c <= range.endCol; c++) {
                row.push(readCellStyle(doc, sheetId, r, c) ?? {})
            }
            cells.push(row)
        }
        state.setFormatPainter(cells, range)
    }, [readOnly, doc, sheetId, instance.store])

    const applyFormatPainterIfActive = useCallback(() => {
        const state = instance.store.getState()
        if (state.formatPainterCells == null || doc == null) return
        const range = primaryRange(state.selection)
        if (range == null) return
        applyFormatPainterToDest(doc, sheetId, state.formatPainterCells, range, rows, cols)
        state.clearFormatPainter()
    }, [doc, sheetId, instance.store, rows, cols])

    useEffect(() => {
        if (Platform.OS !== 'web') return
        const cls = 'calc-format-painter-active'
        const root = document.documentElement
        if (isFormatPainterActive) {
            root.classList.add(cls)
        } else {
            root.classList.remove(cls)
        }
        return () => {
            root.classList.remove(cls)
        }
    }, [isFormatPainterActive])

    const toolbar = useGridToolbarToggles({ doc, sheetId, readOnly })
    const format = useGridFormatControls({
        doc,
        sheetId,
        readOnly,
        selectedCellValue: toolbar.selectedCellValue,
    })
    const formulaBar = useGridFormulaBar({
        selectedRow: toolbar.selectedRow,
        selectedCol: toolbar.selectedCol,
        hasSelection: toolbar.hasSelection,
        readOnly,
        selectedCellValue: toolbar.selectedCellValue,
    })
    const suggestions = useGridSuggestions({
        doc,
        sheetId,
        colOffsets,
        rowOffsets,
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
    })
    // Capture the body row container's y offset within the Grid root so
    // the formula-suggestion popover (and any future viewport-anchored
    // overlay) can position itself against the real layout instead of
    // summing brittle constants. The menubar/toolbar/status-banner
    // stack between the Grid root and the body has changed heights more
    // than once and is conditional in places, which has bitten the
    // popover's vertical anchor.
    //
    // Measure the body row RELATIVE TO THE GRID ROOT via measureLayout
    // rather than reading LayoutChangeEvent's y — the latter is
    // parent-relative, so any wrapper inserted between the root and the
    // body row (e.g. GridCanvasTheme's light-scope backing View) would
    // silently shift bodyTop and misplace the popover. Measuring against
    // the root keeps the invariant regardless of intermediate nesting.
    const gridRootRef = useRef<View>(null)
    const bodyRowRef = useRef<View>(null)
    const setBodyTop = useGridStore(s => s.setBodyTop)
    const onBodyContainerLayout = useCallback(
        (_e: LayoutChangeEvent) => {
            const root = gridRootRef.current
            const bodyRow = bodyRowRef.current
            if (root == null || bodyRow == null) return
            bodyRow.measureLayout(
                root,
                (_x, y) => setBodyTop(y),
                () => {}
            )
        },
        [setBodyTop]
    )
    useRefDragExtender()
    useCommentShortcut(instance.store, readOnly)
    // Cmd+C / Cmd+X / Cmd+V plus paste-special variants. Wired here so
    // the shortcuts live for the lifetime of the Grid mount. The
    // clipboard hook owns the actual copy/paste plumbing.
    const clipboard = useClipboard({ doc, sheetId, store: instance.store, readOnly })

    // Native paste event listener — reads clipboard data synchronously
    // from event.clipboardData, bypassing the async Clipboard API which
    // requires clipboard-read permission and breaks in Safari from a
    // keydown context. The Cmd+V tinykeys shortcut is intentionally NOT
    // registered so the browser fires this native paste event instead.
    //
    // Guard: skip when a cell editor TextInput has focus (the input
    // handles its own paste to insert text into the formula). Any
    // <input> or <textarea> that is NOT the grid's own editor (formula
    // bar, dialogs) also keeps its default paste behaviour.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        const handler = (event: ClipboardEvent) => {
            const active = document.activeElement
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
            const state = instance.store.getState()
            if (state.editSession != null) return
            event.preventDefault()
            clipboard.pasteFromNativeEvent(event)
        }
        window.addEventListener('paste', handler)
        return () => window.removeEventListener('paste', handler)
    }, [clipboard, instance.store])

    const findStore = useFindStoreApi()
    const findActions = useFindActions({ doc, sheetId, findStore, readOnly })
    const onOpenFind = useCallback(() => findActions.openFind(), [findActions])

    const toolbarActions = useGridToolbarActions(instance.store)

    // Read every sub-range out of the live selection at call time.
    // Stable identity across selection drags (the store ref is stable)
    // so useClearFormatting's returned callback doesn't churn the
    // shortcut bundle's memo. Mirrors the resolveRanges pattern in
    // useGridFormatControls (which keeps that helper internal).
    const getSelectionRanges = useCallback(
        () => allRanges(instance.store.getState().selection),
        [instance.store]
    )
    const onClearFormatting = useClearFormatting({
        sheetId,
        getSelectionRanges,
        readOnly,
    })

    // Stable identity for the format-shortcut bundle so the shortcut
    // registry doesn't churn on every render.
    const formatShortcuts = useMemo(
        () => ({
            toggleBold: toolbar.onToggleBold,
            toggleItalic: toolbar.onToggleItalic,
            toggleUnderline: toolbar.onToggleUnderline,
            toggleStrike: toolbar.onToggleStrike,
            clearFormatting: onClearFormatting,
        }),
        [
            toolbar.onToggleBold,
            toolbar.onToggleItalic,
            toolbar.onToggleUnderline,
            toolbar.onToggleStrike,
            onClearFormatting,
        ]
    )
    const onSelectAll = useCallback(
        () => instance.store.getState().selectAll(rows, cols),
        [instance.store, rows, cols]
    )

    useCalcShortcuts({
        store: instance.store,
        clipboard,
        format: formatShortcuts,
        find: findActions,
        findStore,
        readOnly,
        onSelectAll,
    })

    const csvDownload = useCsvDownload(doc, sheetId, sheets, sheet?.name)
    const filter = useGridFilterControls({ doc, sheetId, store: instance.store })
    useReactiveFilter(doc, sheetId, sheet?.frozenRows ?? 0)
    const printDialog = useGridPrintDialog(sheetId)
    const freeze = useGridFreezeControls(instance.store)
    const sheetActions = useSheetActions(doc)

    const allSheets = useAllYSheets(doc)

    // Opens the conditional-formatting drawer, seeded with the
    // current selection as the default range for a new rule. The
    // panel store keys by sheet id so multi-sheet workbooks keep
    // independent panel state.
    const onOpenConditionalFormatting = useCallback(() => {
        const selection = instance.store.getState().selection
        const defaultRanges = allRanges(selection).map(r =>
            rangeToSheetRelativeA1(r.startRow, r.startCol, r.endRow, r.endCol)
        )
        useConditionalFormatPanelStore.getState().open(sheetId, { defaultRanges })
    }, [instance.store, sheetId])

    // Opens the Name Manager dialog in list mode. Stable identity so
    // the memoized Toolbar / MenuBar don't churn on Grid re-renders.
    const onOpenNamedRanges = useCallback(() => {
        useNamedRangesDialogStore.getState().openList()
    }, [])

    // Pre-fill the pivot-insert dialog from the current selection's
    // bounding box (Excel/Sheets convention). Subscribing to four
    // primitives keeps the memo'd Toolbar from re-rendering on
    // unrelated state changes — same shape as useGridFreezeControls.
    // When there's no selection, fall back to the active sheet's used
    // range so the user gets a sensible default either way.
    const selStartRow = useGridStore(s => unionBoundingBox(s.selection)?.startRow ?? null)
    const selStartCol = useGridStore(s => unionBoundingBox(s.selection)?.startCol ?? null)
    const selEndRow = useGridStore(s => unionBoundingBox(s.selection)?.endRow ?? null)
    const selEndCol = useGridStore(s => unionBoundingBox(s.selection)?.endCol ?? null)
    const activeSheetName = sheet?.name ?? 'Sheet1'
    const pivotSourceRangeDefault =
        selStartRow != null && selStartCol != null && selEndRow != null && selEndCol != null
            ? buildA1Range(activeSheetName, selStartRow, selStartCol, selEndRow, selEndCol)
            : buildA1Range(activeSheetName, 1, 1, Math.max(rows, 1), Math.max(cols, 1))
    const pivotTargetSheetNameDefault = defaultTargetSheetName(activeSheetName)

    // Shared prop identity for the toolbar and the menubar; both
    // consume the same bag so the menubar mirroring stays in lockstep
    // with the toolbar without duplicating field declarations.
    const toolbarPropsBundle: ToolbarProps = {
        disabled: readOnly || !toolbar.hasSelection,
        canUndo: undoState.canUndo,
        canRedo: undoState.canRedo,
        onUndo: undoState.undo,
        onRedo: undoState.redo,
        isBold: toolbar.isBold,
        isItalic: toolbar.isItalic,
        isUnderline: toolbar.isUnderline,
        isStrike: toolbar.isStrike,
        onToggleBold: toolbar.onToggleBold,
        onToggleItalic: toolbar.onToggleItalic,
        onToggleUnderline: toolbar.onToggleUnderline,
        onToggleStrike: toolbar.onToggleStrike,
        currentNumFmt: format.currentNumFmt,
        onApplyPreset: format.applyPreset,
        onApplyCurrency: format.applyCurrency,
        onApplyPercent: format.applyPercent,
        onDecreaseDecimal: format.decreaseDecimal,
        onIncreaseDecimal: format.increaseDecimal,
        fontSize: format.fontSize,
        onSetFontSize: format.setFontSize,
        fontColor: format.fontColor,
        onSetFontColor: format.setFontColor,
        fillColor: format.fillColor,
        onSetFillColor: format.setFillColor,
        borders: format.borders,
        onSetBorders: format.setBorders,
        horizontalAlign: format.horizontalAlign,
        onSetHorizontalAlign: format.setHorizontalAlign,
        isFormatPainterActive,
        onActivateFormatPainter: activateFormatPainter,
        onOpenFind: onOpenFind,
        onDownloadCsvCurrent: csvDownload.downloadCurrent,
        onDownloadCsvAll: csvDownload.downloadAll,
        onOpenPrint: printDialog.open,
        onOpenSort: toolbarActions.openSort,
        onToggleFilter: filter.toggleFilter,
        isFilterActive: filter.isFilterActive,
        onMergeAll: toolbarActions.mergeAll,
        onMergeHorizontal: toolbarActions.mergeHorizontal,
        onMergeVertical: toolbarActions.mergeVertical,
        onUnmerge: toolbarActions.unmerge,
        onOpenNamedRanges,
        frozenRows,
        frozenCols,
        selectionBottomRow: freeze.selectionBottomRow,
        selectionRightCol: freeze.selectionRightCol,
        onSetFrozenRows: freeze.setFrozenRows,
        onSetFrozenCols: freeze.setFrozenCols,
        onUnfreeze: freeze.unfreeze,
        doc,
        pivotSourceRangeDefault,
        pivotTargetSheetNameDefault,
        onPivotSheetActivated: onActivateSheet,
    }

    // tabIndex + onKeyDown are web-only DOM props that React Native's <View>
    // accepts when rendered on web but doesn't surface in its typed prop set.
    const sentinelWebProps = {
        tabIndex: -1,
        onKeyDown: onSentinelKeyDown,
        style: {
            position: 'absolute',
            width: 0,
            height: 0,
            overflow: 'hidden',
            outline: 'none',
        },
    }

    return (
        <View ref={gridRootRef} className="flex-1 bg-background web:select-none">
            {/* Focus sentinel: zero-size focusable element that holds keyboard
                focus between edit sessions so arrow keys / typing work without
                requiring a double-click to re-activate the grid. */}
            <View ref={sentinelRef} {...(sentinelWebProps as Record<string, unknown>)} />
            <MenuBar
                {...toolbarPropsBundle}
                workbookId={driveItemId}
                workbookName={workbookName}
                fileActions={fileActions}
                onClearFormatting={onClearFormatting}
                onCopy={() => void clipboard.copy()}
                onCut={() => void clipboard.cut()}
                onPaste={() => void clipboard.paste()}
                onPasteValues={() => void clipboard.paste('values')}
                onPasteFormat={() => void clipboard.paste('format')}
                onOpenFindReplace={onOpenFind}
                onOpenConditionalFormatting={onOpenConditionalFormatting}
                allSheets={allSheets}
                onShowSheet={id => sheetActions.showSheet(id)}
                onShowComments={onShowComments}
                isReadOnly={readOnly}
            />
            <Toolbar {...toolbarPropsBundle} />
            <SortStatusBanner />
            <SelectionStatusBanner />
            <FormulaBar
                ref={instance.formulaBarInputRef}
                leftSlot={<NameBox doc={doc} sheetId={sheetId} onActivateSheet={onActivateSheet} />}
                value={formulaBar.value}
                selection={formulaBar.selection}
                disabled={readOnly || !toolbar.hasSelection}
                onChange={formulaBar.onChange}
                onSelectionChange={formulaBar.onSelectionChange}
                onCommit={formulaBar.onCommit}
                onCancel={formulaBar.onCancel}
                onFocus={formulaBar.onFocus}
                onSpecialKey={suggestions.onSpecialKey}
                onAnchorLayout={formulaBar.onAnchorLayout}
            />
            {/* The grid data area (row/column headers + cells) is pinned to
                the light palette so imported .xlsx colors, authored for a
                white page, stay faithful and readable in dark mode. Chrome
                above/below stays theme-following. */}
            <GridCanvasTheme onLayout={onBodyContainerLayout}>
                <View className="flex-row">
                    <CornerCell store={instance.store} rowCount={rows} colCount={cols} />
                    <ColumnHeader
                        scrollRef={viewport.headerScrollRef}
                        contentWidth={contentWidth}
                        colOffsets={colOffsets}
                        firstCol={viewport.visible.firstCol}
                        lastCol={viewport.visible.lastCol}
                        rowCount={rows}
                        frozenCols={frozenCols}
                        makeHandleProps={colResize.makeHandleProps}
                        dragState={colResize.dragState}
                        filterRange={filter.filterRange}
                        activeFilterCols={filter.activeFilterCols}
                        filterMode={filter.filterView?.mode ?? null}
                        onRemoveColumnCriterion={filter.removeHeaderCriterion}
                        onFormatPainterApply={applyFormatPainterIfActive}
                    />
                </View>
                <View ref={bodyRowRef} className="flex-1 flex-row" onLayout={onBodyContainerLayout}>
                    <RowHeader
                        scrollRef={viewport.leftColumnScrollRef}
                        contentHeight={contentHeight}
                        rowOffsets={rowOffsets}
                        firstRow={viewport.visible.firstRow}
                        lastRow={viewport.visible.lastRow}
                        colCount={cols}
                        frozenRows={frozenRows}
                        makeHandleProps={rowResize.makeHandleProps}
                        dragState={rowResize.dragState}
                        onFormatPainterApply={applyFormatPainterIfActive}
                    />
                    <Body
                        horizontalRef={viewport.horizontalRef}
                        verticalRef={viewport.verticalRef}
                        contentWidth={contentWidth}
                        contentHeight={contentHeight}
                        colOffsets={colOffsets}
                        rowOffsets={rowOffsets}
                        colDragState={colResize.dragState}
                        rowDragState={rowResize.dragState}
                        visible={viewport.visible}
                        sheet={sheet}
                        cellEditorInputRef={instance.cellEditorInputRef}
                        presenceOnSheet={presenceOnSheet}
                        readOnly={readOnly}
                        frozenRows={frozenRows}
                        frozenCols={frozenCols}
                        frozenRowHorizontalRef={viewport.frozenRowHorizontalRef}
                        frozenColVerticalRef={viewport.frozenColVerticalRef}
                        onSpecialKey={suggestions.onSpecialKey}
                        onLayout={viewport.onBodyLayout}
                        onHorizontalScroll={viewport.onHorizontalScroll}
                        onVerticalScroll={viewport.onVerticalScroll}
                    />
                </View>
            </GridCanvasTheme>
            <CellContextMenu doc={doc} sheetId={sheetId} />
            <CommentPopover driveItemId={driveItemId} sheetId={sheetId} />
            <CalcCommentDrawer
                driveItemId={driveItemId}
                sheets={allSheets}
                activeSheetId={sheetId}
                onActivateSheet={onActivateSheet}
            />
            <SortDialog doc={doc} sheetId={sheetId} />
            <PrintDialog
                isOpen={printDialog.isOpen}
                onClose={printDialog.close}
                doc={doc}
                driveItemId={driveItemId}
                currentSheetId={sheetId}
                currentSelection={printDialog.currentSelection}
            />
            <FilterColumnDialog doc={doc} sheetId={sheetId} />
            <HandleContextMenu
                onAutosizeCol={col => autosizeCol(doc, sheetId, col)}
                onResetCol={(col, width) => commitColWidth(doc, sheetId, col, width)}
                onResetRow={(row, height) => commitRowHeight(doc, sheetId, row, height)}
                rowCount={sheet?.rowCount ?? 0}
                colCount={sheet?.colCount ?? 0}
                displayedRowCount={rows}
                displayedColCount={cols}
            />
            <HeaderContextMenu doc={doc} sheetId={sheetId} />
            <FormulaSuggestionList
                items={suggestions.items}
                selectedIndex={suggestions.selectedIndex}
                anchor={suggestions.anchor}
                onSelect={suggestions.onSelect}
                onHover={suggestions.onHover}
            />
            <FindReplaceDialogGate actions={findActions} />
            <ConditionalFormatPanel doc={doc} sheetId={sheetId} readOnly={readOnly} />
            <NamedRangesDialog doc={doc} />
        </View>
    )
}
