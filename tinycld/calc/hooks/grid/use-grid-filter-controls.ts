import { useCallback, useMemo } from 'react'
import type * as Y from 'yjs'
import { applyFilter, clearFilter, type FilterDefinition } from '../../lib/filter'
import { isDisjoint, primaryRange } from '../../lib/selection-range'
import { useFilterView } from '../use-filter-view'
import type { GridStoreApi } from '../grid-store'

export interface GridFilterControls {
    filterView: FilterDefinition | null
    filterRange: FilterDefinition['range'] | null
    activeFilterCols: Set<number>
    isFilterActive: boolean
    toggleFilter: () => void
}

interface UseGridFilterControlsArgs {
    doc: Y.Doc | null
    sheetId: string
    store: GridStoreApi
}

// Reads the persistent filter view (yjs-backed sheet metadata) and
// derives the toolbar's "filter active" state plus the per-column
// active set the column header uses to paint its active-filter
// indicator. toggleFilter creates a filter from the current selection
// when none is set, otherwise clears the existing one.
export function useGridFilterControls({
    doc,
    sheetId,
    store,
}: UseGridFilterControlsArgs): GridFilterControls {
    const filterView = useFilterView(doc, sheetId)
    const filterRange = filterView?.range ?? null
    const activeFilterCols = useMemo(() => {
        const set = new Set<number>()
        if (filterView != null) {
            for (const key of Object.keys(filterView.criteria)) {
                const c = Number(key)
                if (Number.isFinite(c)) set.add(c)
            }
        }
        return set
    }, [filterView])

    const toggleFilter = useCallback(() => {
        if (doc == null) return
        const state = store.getState()
        if (filterView != null) {
            clearFilter(doc, sheetId)
            return
        }
        // Filter views are a single contiguous rectangle on yjs
        // metadata — disjoint doesn't apply. Per plan Tier B, use
        // primary sub-range; the UI affordance hides on disjoint
        // (see CellContextMenu).
        if (isDisjoint(state.selection)) return
        const range = primaryRange(state.selection)
        if (range == null) return
        applyFilter(doc, sheetId, { range, criteria: {} })
    }, [doc, sheetId, store, filterView])

    return {
        filterView,
        filterRange,
        activeFilterCols,
        isFilterActive: filterView != null,
        toggleFilter,
    }
}
