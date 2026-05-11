import { forwardRef, useCallback, useMemo } from 'react'
import { View } from 'react-native'
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
import { useClipboard } from '../hooks/use-clipboard'
import { useCommentShortcut } from '../hooks/use-comment-shortcut'
import { GridStoreProvider } from '../hooks/use-grid-store'
import { createPrintDialogStore, PrintDialogProvider } from '../hooks/use-print-dialog'
import { usePresence } from '../hooks/use-presence'
import type { UndoManagerState } from '../hooks/use-undo-manager'
import { useWorkbook } from '../hooks/use-workbook-context'
import { useYSheets } from '../hooks/use-y-sheets'
import { buildColOffsets, buildRowOffsets } from '../lib/dimensions'
import { FindReplaceDialogGate } from './FindReplaceDialog'
import { PrintDialog } from './PrintDialog'
import { FormulaBar } from './FormulaBar'
import { FormulaSuggestionList } from './FormulaSuggestionList'
import { Body } from './grid/Body'
import { CellContextMenu } from './grid/CellContextMenu'
import { ColumnHeader } from './grid/ColumnHeader'
import { CommentPopover } from './grid/CommentPopover'
import { CornerCell } from './grid/CornerCell'
import { MIN_COLS, MIN_ROWS } from './grid/constants'
import { FilterDropdownAnchor } from './grid/FilterDropdown'
import { HandleContextMenu } from './grid/HandleContextMenu'
import { RowHeader } from './grid/RowHeader'
import { autosizeCol, commitColWidth, commitRowHeight } from './grid/resize-actions'
import { SortDialog } from './grid/SortDialog'
import { SortStatusBanner } from './SortStatusBanner'
import { Toolbar } from './Toolbar'

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
    { sheetId, driveItemId, minRows = MIN_ROWS, minCols = MIN_COLS, readOnly = false, undoState },
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

    const presence = usePresence(awareness)
    const presenceOnSheet = useMemo(
        () => presence.filter(p => p.sheetId === sheetId),
        [presence, sheetId]
    )

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
        colOffsets,
        rowOffsets,
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
    })
    useRefDragExtender()
    useCommentShortcut(instance.store, readOnly)
    // Cmd+C / Cmd+X / Cmd+V plus paste-special variants. Wired here so
    // the shortcuts live for the lifetime of the Grid mount. The
    // clipboard hook owns the actual copy/paste plumbing.
    const clipboard = useClipboard({ doc, sheetId, store: instance.store, readOnly })
    const findStore = useFindStoreApi()
    const findActions = useFindActions({ doc, sheetId, findStore, readOnly })
    const onOpenFind = useCallback(() => findActions.openFind(), [findActions])

    const toolbarActions = useGridToolbarActions(instance.store)

    // Stable identity for the format-shortcut bundle so the shortcut
    // registry doesn't churn on every render.
    const formatShortcuts = useMemo(
        () => ({
            toggleBold: toolbar.onToggleBold,
            toggleItalic: toolbar.onToggleItalic,
            toggleUnderline: toolbar.onToggleUnderline,
            toggleStrike: toolbar.onToggleStrike,
        }),
        [
            toolbar.onToggleBold,
            toolbar.onToggleItalic,
            toolbar.onToggleUnderline,
            toolbar.onToggleStrike,
        ]
    )
    useCalcShortcuts({
        store: instance.store,
        clipboard,
        format: formatShortcuts,
        find: findActions,
        findStore,
        readOnly,
    })

    const csvDownload = useCsvDownload(doc, sheetId, sheets, sheet?.name)
    const filter = useGridFilterControls({ doc, sheetId, store: instance.store })
    const printDialog = useGridPrintDialog(sheetId)
    const freeze = useGridFreezeControls(instance.store)

    return (
        <View className="flex-1 bg-background web:select-none">
            <Toolbar
                disabled={readOnly || !toolbar.hasSelection}
                canUndo={undoState.canUndo}
                canRedo={undoState.canRedo}
                onUndo={undoState.undo}
                onRedo={undoState.redo}
                isBold={toolbar.isBold}
                isItalic={toolbar.isItalic}
                isUnderline={toolbar.isUnderline}
                isStrike={toolbar.isStrike}
                onToggleBold={toolbar.onToggleBold}
                onToggleItalic={toolbar.onToggleItalic}
                onToggleUnderline={toolbar.onToggleUnderline}
                onToggleStrike={toolbar.onToggleStrike}
                currentNumFmt={format.currentNumFmt}
                onApplyPreset={format.applyPreset}
                onApplyCurrency={format.applyCurrency}
                onApplyPercent={format.applyPercent}
                onDecreaseDecimal={format.decreaseDecimal}
                onIncreaseDecimal={format.increaseDecimal}
                fontSize={format.fontSize}
                onSetFontSize={format.setFontSize}
                fontColor={format.fontColor}
                onSetFontColor={format.setFontColor}
                fillColor={format.fillColor}
                onSetFillColor={format.setFillColor}
                borders={format.borders}
                onSetBorders={format.setBorders}
                horizontalAlign={format.horizontalAlign}
                onSetHorizontalAlign={format.setHorizontalAlign}
                onOpenFind={onOpenFind}
                onDownloadCsvCurrent={csvDownload.downloadCurrent}
                onDownloadCsvAll={csvDownload.downloadAll}
                onOpenPrint={printDialog.open}
                onOpenSort={toolbarActions.openSort}
                onToggleFilter={filter.toggleFilter}
                isFilterActive={filter.isFilterActive}
                onMergeAll={toolbarActions.mergeAll}
                onMergeHorizontal={toolbarActions.mergeHorizontal}
                onMergeVertical={toolbarActions.mergeVertical}
                onUnmerge={toolbarActions.unmerge}
                frozenRows={frozenRows}
                frozenCols={frozenCols}
                selectionBottomRow={freeze.selectionBottomRow}
                selectionRightCol={freeze.selectionRightCol}
                onSetFrozenRows={freeze.setFrozenRows}
                onSetFrozenCols={freeze.setFrozenCols}
                onUnfreeze={freeze.unfreeze}
            />
            <SortStatusBanner />
            <FormulaBar
                ref={instance.formulaBarInputRef}
                cellLabel={formulaBar.cellLabel}
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
            <View className="flex-row">
                <CornerCell />
                <ColumnHeader
                    scrollRef={viewport.headerScrollRef}
                    contentWidth={contentWidth}
                    colOffsets={colOffsets}
                    firstCol={viewport.visible.firstCol}
                    lastCol={viewport.visible.lastCol}
                    frozenCols={frozenCols}
                    makeHandleProps={colResize.makeHandleProps}
                    dragState={colResize.dragState}
                    filterRange={filter.filterRange}
                    activeFilterCols={filter.activeFilterCols}
                />
            </View>
            <View className="flex-1 flex-row">
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
            <CellContextMenu doc={doc} sheetId={sheetId} />
            <CommentPopover driveItemId={driveItemId} sheetId={sheetId} />
            <SortDialog doc={doc} sheetId={sheetId} />
            <PrintDialog
                isOpen={printDialog.isOpen}
                onClose={printDialog.close}
                doc={doc}
                currentSheetId={sheetId}
                currentSelection={printDialog.currentSelection}
            />
            <FilterDropdownAnchor
                doc={doc}
                sheetId={sheetId}
                colOffsets={colOffsets}
                scrollX={viewport.scrollX}
            />
            <HandleContextMenu
                onAutosizeCol={col => autosizeCol(doc, sheetId, col)}
                onResetCol={(col, width) => commitColWidth(doc, sheetId, col, width)}
                onResetRow={(row, height) => commitRowHeight(doc, sheetId, row, height)}
                rowCount={sheet?.rowCount ?? 0}
                colCount={sheet?.colCount ?? 0}
                displayedRowCount={rows}
                displayedColCount={cols}
            />
            <FormulaSuggestionList
                items={suggestions.items}
                selectedIndex={suggestions.selectedIndex}
                anchor={suggestions.anchor}
                onSelect={suggestions.onSelect}
                onHover={suggestions.onHover}
            />
            <FindReplaceDialogGate actions={findActions} />
        </View>
    )
}
