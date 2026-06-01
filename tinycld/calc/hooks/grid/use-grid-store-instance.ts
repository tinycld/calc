import { useEffect, useMemo, useRef } from 'react'
import type { TextInput } from 'react-native'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { subscribeAwarenessToStore } from '../../components/grid/subscribe-awareness'
import { applyFill as applyFillToDoc } from '../../lib/fill/apply-fill'
import {
    expandRangeOverMerges,
    getAllMerges,
    mergeCells,
    snapPointToMerge,
    unmergeCells,
} from '../../lib/merge'
import { usePendingSheetSelectionStore } from '../../lib/stores/pending-sheet-selection-store'
import {
    deleteColumns,
    deleteRows,
    insertColumns,
    insertRows,
} from '../../lib/structural-mutations'
import type { CellRange } from '../grid-store'
import { createGridStore, type GridStoreApi, type GridStoreDeps } from '../grid-store'
import { clearYCellContent, setYCell } from '../use-y-cell'
import { setFrozenCols, setFrozenRows } from '../use-y-sheets'

export interface GridStoreInstance {
    store: GridStoreApi
    formulaBarInputRef: React.RefObject<TextInput | null>
    cellEditorInputRef: React.RefObject<TextInput | null>
    // Set by GridInner after the viewport is ready; the store's
    // navigateSelection / commitAndNavigate actions call through this
    // to scroll the new cell into view.
    scrollToCellRef: React.MutableRefObject<((row: number, col: number) => void) | null>
    // Set by GridInner to point at the web-only focus sentinel element.
    // Called after navigation / edit-commit so keyboard events keep
    // working without a double-click to re-focus the grid.
    focusSentinelRef: React.MutableRefObject<(() => void) | null>
}

interface UseGridStoreInstanceArgs {
    doc: Y.Doc
    awareness: Awareness
    sheetId: string
    readOnly: boolean
}

// Owns the per-Grid Zustand store and the two TextInput refs the
// store's focusActiveInput dep needs. Also wires the awareness
// publish loop so any selection/edit change reaches peers — replaces
// the ~10 publishLocal calls that used to be scattered across every
// action.
//
// useMemo's deps recreate the store when sheetId, doc, or readOnly
// change. Sheet switches reset selection/edit state, which is the
// intended behavior.
export function useGridStoreInstance({
    doc,
    awareness,
    sheetId,
    readOnly,
}: UseGridStoreInstanceArgs): GridStoreInstance {
    const formulaBarInputRef = useRef<TextInput>(null)
    const cellEditorInputRef = useRef<TextInput>(null)
    const scrollToCellRef = useRef<((row: number, col: number) => void) | null>(null)
    const focusSentinelRef = useRef<(() => void) | null>(null)

    const store = useMemo(() => {
        // Holder lets the focusActiveInput closure call back into the
        // store after the store itself has been assigned. We can't
        // capture `store` directly because we're inside its
        // initializer; we can't put activeSurface into a separate ref
        // because it lives in the store. The holder is a single
        // object whose .api field is set right after createGridStore
        // returns.
        const holder: { api: GridStoreApi | null } = { api: null }
        const deps: GridStoreDeps = {
            readOnly,
            writeCell: (row, col, value) => setYCell(doc, sheetId, row, col, value),
            clearCellContent: (row, col) => clearYCellContent(doc, sheetId, row, col),
            focusActiveInput: () => {
                const surface = holder.api?.getState().activeSurface ?? 'cell'
                const target =
                    surface === 'bar' ? formulaBarInputRef.current : cellEditorInputRef.current
                target?.focus()
            },
            scrollToCell: (row, col) => scrollToCellRef.current?.(row, col),
            focusSentinel: () => focusSentinelRef.current?.(),
            setFrozenRows: n => setFrozenRows(doc, sheetId, n),
            setFrozenCols: n => setFrozenCols(doc, sheetId, n),
            applyStructuralMutation: op => {
                if (readOnly) return
                switch (op.kind) {
                    case 'insertRows':
                        insertRows(
                            doc,
                            sheetId,
                            op.atRow,
                            op.count,
                            op.position,
                            op.displayedRowCount
                        )
                        break
                    case 'insertColumns':
                        insertColumns(
                            doc,
                            sheetId,
                            op.atCol,
                            op.count,
                            op.position,
                            op.displayedColCount
                        )
                        break
                    case 'deleteRows':
                        deleteRows(doc, sheetId, op.fromRow, op.count)
                        break
                    case 'deleteColumns':
                        deleteColumns(doc, sheetId, op.fromCol, op.count)
                        break
                }
            },
            applyFill: ({ sourceRange, destRange, direction }) => {
                if (readOnly) return
                applyFillToDoc({ doc, sheetId, sourceRange, destRange, direction })
            },
            resolveMergeAnchor: (row, col) => snapPointToMerge(doc, sheetId, row, col),
            expandRangeOverMerges: (range: CellRange) => expandRangeOverMerges(doc, sheetId, range),
            findMergesInRange: (range: CellRange) =>
                getAllMerges(doc, sheetId).filter(m => {
                    const mEndRow = m.anchorRow + m.rowSpan - 1
                    const mEndCol = m.anchorCol + m.colSpan - 1
                    return !(
                        mEndRow < range.startRow ||
                        m.anchorRow > range.endRow ||
                        mEndCol < range.startCol ||
                        m.anchorCol > range.endCol
                    )
                }),
            mergeRange: (range: CellRange) => {
                if (readOnly) return
                mergeCells(doc, sheetId, range)
            },
            unmergeAt: (anchorRow, anchorCol) => {
                if (readOnly) return
                unmergeCells(doc, sheetId, anchorRow, anchorCol)
            },
        }
        const api = createGridStore(deps)
        holder.api = api
        return api
    }, [sheetId, doc, readOnly])

    useEffect(
        () => subscribeAwarenessToStore(store, awareness, sheetId),
        [store, awareness, sheetId]
    )

    // Apply a pending cross-sheet selection staged by the NameBox.
    // The store is recreated on sheetId change, so a NameBox jump from
    // Sheet1 → Sheet2 lands here on the new sheet's first effect pass.
    // consume() is a no-op when the staged selection targets a different
    // sheet (e.g. left over from a stale request).
    useEffect(() => {
        const pending = usePendingSheetSelectionStore.getState().consume(sheetId)
        if (pending == null) return
        const api = store.getState()
        api.selectCell(pending.cell)
        if (pending.range != null) {
            api.extendActiveRangeTo({
                row: pending.range.endRow,
                col: pending.range.endCol,
            })
        }
    }, [store, sheetId])

    return { store, formulaBarInputRef, cellEditorInputRef, scrollToCellRef, focusSentinelRef }
}
