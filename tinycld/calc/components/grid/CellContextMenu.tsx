import { Menu } from '@tinycld/core/ui/menu'
import { useCallback, useMemo } from 'react'
import type * as Y from 'yjs'
import { useClipboard } from '../../hooks/use-clipboard'
import { useFilterView } from '../../hooks/use-filter-view'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { useSheetConditionalFormats } from '../../hooks/use-sheet-conditional-formats'
import { setYCell } from '../../hooks/use-y-cell'
import { useYSheets } from '../../hooks/use-y-sheets'
import { rangeToSheetRelativeA1 } from '../../lib/conditional-format/a1'
import { anyRuleOverlapsRect } from '../../lib/conditional-format/range-index'
import { applyValuesFilterFromSelection, clearFilter } from '../../lib/filter'
import { encodeSheetName } from '../../lib/named-ranges/sheet-prefix'
import { pluralize } from '../../lib/pluralize'
import {
    allRanges,
    forEachCellInSelection,
    isDisjoint,
    primaryRange,
} from '../../lib/selection-range'
import { detectHeaderRow, sortRange } from '../../lib/sort'
import { useConditionalFormatPanelStore } from '../../lib/stores/conditional-format-panel-store'
import { useNamedRangesDialogStore } from '../../lib/stores/named-ranges-dialog-store'
import { columnLabel } from '../../lib/workbook-types'
import { MIN_COLS, MIN_ROWS } from './constants'

interface CellContextMenuProps {
    doc: Y.Doc | null
    sheetId: string
}

// Single Menu instance shared by every cell. Mounted in Grid so cells
// stay free of any per-cell Menu overhead. Anchored at the cursor/touch
// point; the overlay engine places it beside the point, flips it at the
// viewport edge and dismisses it on an outside press.
export function CellContextMenu({ doc, sheetId }: CellContextMenuProps) {
    const target = useGridStore(s => s.contextTarget)
    // Read the live selection so range-aware menu actions (clear,
    // sort/filter) cover every cell currently highlighted.
    // openCellContextMenu has already collapsed the range to a single
    // cell when the right-click landed outside any prior sub-range,
    // so this naturally reduces to single-cell when there's no range.
    const selection = useGridStore(s => s.selection)
    const disjoint = useGridStore(s => isDisjoint(s.selection))
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeCellContextMenu(), [store])

    const isOpen = target != null
    const anchor = useMemo(
        () => (target ? { x: target.cursor.x, y: target.cursor.y } : undefined),
        [target]
    )

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    // Tier B consumer: structural insert/delete and sort/filter
    // route by the primary sub-range (last). Disjoint sub-ranges
    // come along for the shift but the primary drives the op.
    const range = primaryRange(selection)
    const rowSpan = range != null ? range.endRow - range.startRow + 1 : 1
    const colSpan = range != null ? range.endCol - range.startCol + 1 : 1

    const sheets = useYSheets(doc)
    const sheet = sheets.find(s => s.id === sheetId)
    const rowCount = sheet?.rowCount ?? 0
    const colCount = sheet?.colCount ?? 0
    // Grid.tsx clamps the displayed grid up to MIN_ROWS/MIN_COLS, so a
    // fresh sheet shows 50×26 even with rowCount=colCount=0. Pass the
    // displayed dims to insert actions so the post-insert sheet covers
    // the rows/cols the user already saw.
    const displayedRowCount = Math.max(rowCount, MIN_ROWS)
    const displayedColCount = Math.max(colCount, MIN_COLS)

    const onInsertRowAbove = useCallback(
        () => store.getState().insertRowsAtSelection('above', displayedRowCount),
        [store, displayedRowCount]
    )
    const onInsertRowBelow = useCallback(
        () => store.getState().insertRowsAtSelection('below', displayedRowCount),
        [store, displayedRowCount]
    )
    const onInsertColLeft = useCallback(
        () => store.getState().insertColumnsAtSelection('left', displayedColCount),
        [store, displayedColCount]
    )
    const onInsertColRight = useCallback(
        () => store.getState().insertColumnsAtSelection('right', displayedColCount),
        [store, displayedColCount]
    )
    const onDeleteRows = useCallback(
        () => store.getState().deleteSelectedRows(rowCount),
        [store, rowCount]
    )
    const onDeleteCols = useCallback(
        () => store.getState().deleteSelectedColumns(colCount),
        [store, colCount]
    )

    const onClear = useCallback(() => {
        if (selection == null || doc == null) return
        forEachCellInSelection(selection, (row, col) => {
            setYCell(doc, sheetId, row, col, '')
        })
    }, [doc, sheetId, selection])

    const clipboard = useClipboard({ doc, sheetId, store })
    // Fire-and-forget wrappers — async errors are swallowed inside the
    // hook; the menu just closes after the user's tap.
    const onCut = useCallback(() => {
        void clipboard.cut()
    }, [clipboard])
    const onCopy = useCallback(() => {
        void clipboard.copy()
    }, [clipboard])
    const onPaste = useCallback(() => {
        void clipboard.paste('all')
    }, [clipboard])
    const onPasteValues = useCallback(() => {
        void clipboard.paste('values')
    }, [clipboard])
    const onPasteFormulas = useCallback(() => {
        void clipboard.paste('formulas')
    }, [clipboard])
    const onPasteFormat = useCallback(() => {
        void clipboard.paste('format')
    }, [clipboard])
    const onPasteTranspose = useCallback(() => {
        void clipboard.paste('transpose')
    }, [clipboard])

    const onComment = useCallback(() => {
        if (target == null) return
        store
            .getState()
            .openCommentPopover(target.cell.row, target.cell.col, target.cursor.x, target.cursor.y)
    }, [target, store])

    const frozenRows = sheet?.frozenRows ?? 0
    const frozenCols = sheet?.frozenCols ?? 0
    const hasFreeze = frozenRows > 0 || frozenCols > 0
    const bottomRow = range?.endRow ?? null
    const rightCol = range?.endCol ?? null

    const filterView = useFilterView(doc, sheetId)
    // Sort/filter only make sense on a single contiguous rectangle —
    // hide the entries when the selection is disjoint (plan Tier B).
    const hasMultiCellRange = range != null && !disjoint && (rowSpan > 1 || colSpan > 1)

    // Sort uses the active range's first column as the key. The
    // hasHeader flag is detected automatically — a one-shot sort menu
    // item shouldn't pop a dialog.
    const onSortAsc = useCallback(() => {
        if (doc == null || range == null) return
        const hasHeader = detectHeaderRow(doc, sheetId, range)
        const result = sortRange(doc, sheetId, range, range.startCol, 'asc', hasHeader)
        if (result.ok && result.mergesBroken > 0) {
            store.getState().setSortStatus({ mergesBroken: result.mergesBroken })
        }
    }, [doc, sheetId, range, store])

    const onSortDesc = useCallback(() => {
        if (doc == null || range == null) return
        const hasHeader = detectHeaderRow(doc, sheetId, range)
        const result = sortRange(doc, sheetId, range, range.startCol, 'desc', hasHeader)
        if (result.ok && result.mergesBroken > 0) {
            store.getState().setSortStatus({ mergesBroken: result.mergesBroken })
        }
    }, [doc, sheetId, range, store])

    const onCreateFilter = useCallback(() => {
        if (doc == null || range == null) return
        applyValuesFilterFromSelection(doc, sheetId, range, displayedRowCount, frozenRows)
    }, [doc, sheetId, range, displayedRowCount, frozenRows])

    const onRemoveFilter = useCallback(() => {
        if (doc == null) return
        clearFilter(doc, sheetId)
    }, [doc, sheetId])

    const onMergeAll = useCallback(() => store.getState().mergeSelection(), [store])
    const onUnmergeMenuAction = useCallback(() => store.getState().unmergeSelection(), [store])

    const sheetRules = useSheetConditionalFormats(doc, sheetId)
    const hasRuleOnSelection =
        range != null &&
        anyRuleOverlapsRect(sheetRules, {
            startRow: range.startRow,
            startCol: range.startCol,
            endRow: range.endRow,
            endCol: range.endCol,
        })

    const onOpenConditionalFormatting = useCallback(() => {
        const defaultRanges = allRanges(selection).map(r =>
            rangeToSheetRelativeA1(r.startRow, r.startCol, r.endRow, r.endCol)
        )
        useConditionalFormatPanelStore.getState().open(sheetId, { defaultRanges })
        onClose()
    }, [selection, sheetId, onClose])

    const activeSheetName = sheet?.name ?? null
    const onDefineNameFromSelection = useCallback(() => {
        if (range == null || activeSheetName == null) {
            useNamedRangesDialogStore.getState().openCreate()
            onClose()
            return
        }
        const sheetPrefix = encodeSheetName(activeSheetName)
        const sameCell = range.startRow === range.endRow && range.startCol === range.endCol
        const expression = sameCell
            ? `=${sheetPrefix}!$${columnLabel(range.startCol)}$${range.startRow}`
            : `=${sheetPrefix}!$${columnLabel(range.startCol)}$${range.startRow}:$${columnLabel(range.endCol)}$${range.endRow}`
        useNamedRangesDialogStore.getState().openCreate({ expression, scope: null })
        onClose()
    }, [range, activeSheetName, onClose])

    const onManageNamedRanges = useCallback(() => {
        useNamedRangesDialogStore.getState().openList()
        onClose()
    }, [onClose])

    const insertRows = pluralize(rowSpan, 'row')
    const insertCols = pluralize(colSpan, 'column')
    const deleteRowsLabel = rowSpan === 1 ? 'This row' : `These ${rowSpan} rows`
    const deleteColsLabel = colSpan === 1 ? 'This column' : `These ${colSpan} columns`
    const conditionalFormattingLabel = hasRuleOnSelection
        ? 'Edit conditional formatting…'
        : 'Conditional formatting…'

    return (
        <Menu
            isOpen={isOpen}
            onOpenChange={handleOpenChange}
            anchor={anchor}
            presentation="popover"
        >
            <Menu.Item label="Cut" onSelect={onCut} />
            <Menu.Item label="Copy" onSelect={onCopy} />
            <Menu.Item label="Paste" onSelect={onPaste} />
            <Menu.Sub label="Paste special">
                <Menu.Item label="Values only" onSelect={onPasteValues} />
                <Menu.Item label="Formulas only" onSelect={onPasteFormulas} />
                <Menu.Item label="Format only" onSelect={onPasteFormat} />
                <Menu.Item label="Transposed" onSelect={onPasteTranspose} />
            </Menu.Sub>
            <Menu.Separator />
            <Menu.Sub label="Insert">
                <Menu.Item label={`${insertRows} above`} onSelect={onInsertRowAbove} />
                <Menu.Item label={`${insertRows} below`} onSelect={onInsertRowBelow} />
                <Menu.Item label={`${insertCols} left`} onSelect={onInsertColLeft} />
                <Menu.Item label={`${insertCols} right`} onSelect={onInsertColRight} />
            </Menu.Sub>
            <Menu.Sub label="Delete">
                <Menu.Item
                    label={deleteRowsLabel}
                    onSelect={onDeleteRows}
                    isDisabled={rowCount <= 1}
                />
                <Menu.Item
                    label={deleteColsLabel}
                    onSelect={onDeleteCols}
                    isDisabled={colCount <= 1}
                />
            </Menu.Sub>
            <Menu.Separator />
            <Menu.Item label="Clear contents" onSelect={onClear} />
            <Menu.Separator />
            <Menu.Item label="Comment" onSelect={onComment} />
            <Menu.Separator />
            <Menu.Sub label="Freeze">
                <Menu.Item
                    label="Freeze 1 row"
                    onSelect={() => store.getState().setFrozenRows(1)}
                />
                <Menu.Item
                    label="Freeze 2 rows"
                    onSelect={() => store.getState().setFrozenRows(2)}
                />
                <FreezeUpToItem
                    label={`Freeze up to row ${bottomRow}`}
                    index={bottomRow}
                    onSelect={index => store.getState().setFrozenRows(index)}
                />
                <Menu.Item
                    label="Freeze 1 column"
                    onSelect={() => store.getState().setFrozenCols(1)}
                />
                <Menu.Item
                    label="Freeze 2 columns"
                    onSelect={() => store.getState().setFrozenCols(2)}
                />
                <FreezeUpToItem
                    label={`Freeze up to column ${columnLabel(rightCol ?? 0)}`}
                    index={rightCol}
                    onSelect={index => store.getState().setFrozenCols(index)}
                />
                <Menu.Item
                    label="Unfreeze"
                    onSelect={() => store.getState().unfreeze()}
                    isDisabled={!hasFreeze}
                />
            </Menu.Sub>
            <Menu.Separator />
            <SortItems
                isVisible={hasMultiCellRange}
                onSortAsc={onSortAsc}
                onSortDesc={onSortDesc}
            />
            <FilterItem
                filterMode={filterView?.mode ?? null}
                canCreate={range != null && !disjoint}
                onCreate={onCreateFilter}
                onRemove={onRemoveFilter}
            />
            <Menu.Separator />
            <Menu.Item label="Merge cells" onSelect={onMergeAll} isDisabled={disjoint} />
            <Menu.Item label="Unmerge" onSelect={onUnmergeMenuAction} isDisabled={disjoint} />
            <Menu.Separator />
            <Menu.Item label={conditionalFormattingLabel} onSelect={onOpenConditionalFormatting} />
            <Menu.Separator />
            <Menu.Item label="Define name from selection…" onSelect={onDefineNameFromSelection} />
            <Menu.Item label="Manage named ranges…" onSelect={onManageNamedRanges} />
        </Menu>
    )
}

function FreezeUpToItem({
    label,
    index,
    onSelect,
}: {
    label: string
    index: number | null
    onSelect: (index: number) => void
}) {
    if (index == null || index <= 0) return null
    return <Menu.Item label={label} onSelect={() => onSelect(index)} />
}

function SortItems({
    isVisible,
    onSortAsc,
    onSortDesc,
}: {
    isVisible: boolean
    onSortAsc: () => void
    onSortDesc: () => void
}) {
    if (!isVisible) return null
    return (
        <>
            <Menu.Item label="Sort range A→Z" onSelect={onSortAsc} />
            <Menu.Item label="Sort range Z→A" onSelect={onSortDesc} />
        </>
    )
}

// No filter: offer to create one from the selection. A range filter:
// offer to remove it. A header-mode filter is managed from the column
// header menu, so the cell menu shows nothing.
function FilterItem({
    filterMode,
    canCreate,
    onCreate,
    onRemove,
}: {
    filterMode: 'range' | 'header' | null
    canCreate: boolean
    onCreate: () => void
    onRemove: () => void
}) {
    if (filterMode == null)
        return <Menu.Item label="Filter" onSelect={onCreate} isDisabled={!canCreate} />
    if (filterMode === 'range') return <Menu.Item label="Remove filter" onSelect={onRemove} />
    return null
}
