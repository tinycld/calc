import { Menu } from '@tinycld/core/ui/menu'
import { useCallback, useMemo } from 'react'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../../lib/dimensions'

interface HandleContextMenuProps {
    onAutosizeCol: (col: number) => void
    // onResetCol/onResetRow are wired to the same setYColWidth/setYRowHeight
    // setters so writing the default deletes the entry — see lib/dimensions.ts.
    onResetCol: (col: number, width: number) => void
    onResetRow: (row: number, height: number) => void
    // Current sheet dimensions are needed for clamp logic on delete and
    // to disable delete when only one row/column remains.
    rowCount: number
    colCount: number
    // Displayed grid dimensions (rowCount/colCount clamped up to
    // MIN_ROWS/MIN_COLS in Grid.tsx). Inserts use these so a sheet with
    // stored count=0 still expands to cover the visible grid.
    displayedRowCount: number
    displayedColCount: number
}

// Single small menu shared by every column- and row-resize handle.
// Right-click (web) sets the target via the store; selecting an item
// dispatches and closes. Native users don't currently get this menu —
// long-press on a 6px handle isn't a practical mobile gesture, and
// the drag-to-resize gesture already covers the common case.
export function HandleContextMenu({
    onAutosizeCol,
    onResetCol,
    onResetRow,
    rowCount,
    colCount,
    displayedRowCount,
    displayedColCount,
}: HandleContextMenuProps) {
    const target = useGridStore(s => s.handleMenu)
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeHandleMenu(), [store])

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

    const onAutosizeItem = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        onAutosizeCol(target.index)
        onClose()
    }, [target, onAutosizeCol, onClose])

    const onResetItem = useCallback(() => {
        if (target == null) return
        if (target.axis === 'col') {
            onResetCol(target.index, DEFAULT_COL_WIDTH)
        } else {
            onResetRow(target.index, DEFAULT_ROW_HEIGHT)
        }
        onClose()
    }, [target, onResetCol, onResetRow, onClose])

    const onInsertRowAbove = useCallback(() => {
        if (target == null || target.axis !== 'row') return
        store.getState().insertRowAtHandle(target.index, 'above', displayedRowCount)
    }, [target, store, displayedRowCount])
    const onInsertRowBelow = useCallback(() => {
        if (target == null || target.axis !== 'row') return
        store.getState().insertRowAtHandle(target.index, 'below', displayedRowCount)
    }, [target, store, displayedRowCount])
    const onDeleteRow = useCallback(() => {
        if (target == null || target.axis !== 'row') return
        store.getState().deleteRowAtHandle(target.index, rowCount)
    }, [target, store, rowCount])

    const onInsertColLeft = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        store.getState().insertColumnAtHandle(target.index, 'left', displayedColCount)
    }, [target, store, displayedColCount])
    const onInsertColRight = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        store.getState().insertColumnAtHandle(target.index, 'right', displayedColCount)
    }, [target, store, displayedColCount])
    const onDeleteCol = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        store.getState().deleteColumnAtHandle(target.index, colCount)
    }, [target, store, colCount])

    const isCol = target?.axis === 'col'

    return (
        <Menu
            isOpen={isOpen}
            onOpenChange={handleOpenChange}
            anchor={anchor}
            presentation="popover"
        >
            <HandleMenuRows
                isCol={isCol}
                rowCount={rowCount}
                colCount={colCount}
                onInsertColLeft={onInsertColLeft}
                onInsertColRight={onInsertColRight}
                onDeleteCol={onDeleteCol}
                onInsertRowAbove={onInsertRowAbove}
                onInsertRowBelow={onInsertRowBelow}
                onDeleteRow={onDeleteRow}
                onAutosize={onAutosizeItem}
                onReset={onResetItem}
            />
        </Menu>
    )
}

interface HandleMenuRowsProps {
    isCol: boolean
    rowCount: number
    colCount: number
    onInsertColLeft: () => void
    onInsertColRight: () => void
    onDeleteCol: () => void
    onInsertRowAbove: () => void
    onInsertRowBelow: () => void
    onDeleteRow: () => void
    onAutosize: () => void
    onReset: () => void
}

function HandleMenuRows(props: HandleMenuRowsProps) {
    if (props.isCol) {
        return (
            <>
                <Menu.Item label="Insert 1 column left" onSelect={props.onInsertColLeft} />
                <Menu.Item label="Insert 1 column right" onSelect={props.onInsertColRight} />
                <Menu.Item
                    label="Delete column"
                    onSelect={props.onDeleteCol}
                    isDisabled={props.colCount <= 1}
                />
                <Menu.Separator />
                <Menu.Item label="Auto-fit column width" onSelect={props.onAutosize} />
                <Menu.Item label="Reset to default width" onSelect={props.onReset} />
            </>
        )
    }
    return (
        <>
            <Menu.Item label="Insert 1 row above" onSelect={props.onInsertRowAbove} />
            <Menu.Item label="Insert 1 row below" onSelect={props.onInsertRowBelow} />
            <Menu.Item
                label="Delete row"
                onSelect={props.onDeleteRow}
                isDisabled={props.rowCount <= 1}
            />
            <Menu.Separator />
            <Menu.Item label="Reset to default height" onSelect={props.onReset} />
        </>
    )
}
