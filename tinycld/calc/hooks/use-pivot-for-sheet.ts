// Reactive lookup: given a sheet id, return the PivotDefinition that
// owns it — i.e. the pivot whose dedicated output sheet this is — or
// null when the sheet has no pivot association. The grid branches on
// this hook to decide between rendering normal cells and the engine's
// rendered pivot output (see grid Body integration in §9 of the plan).
//
// Implementation note: pure subscribe / computeSnapshot helpers are
// exported via __pivotForSheetHookInternals so tests can exercise the
// data-flow contract without mounting React (the vitest setup runs in
// a node environment without jsdom or @testing-library/react). The
// React hook itself is a thin useSyncExternalStore wrapper.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { readPivot } from '../lib/pivot/y-binding'
import type { PivotDefinition } from '../lib/workbook-types'
import {
    PIVOT_SHEET_KEY,
    PIVOTS_MAP,
    SHEETS_MAP,
} from '../lib/y-doc-bootstrap'

interface SnapshotState {
    cache: PivotDefinition | null
}

function createSnapshotState(): SnapshotState {
    return { cache: null }
}

// We observe BOTH maps because a re-render is required when either:
//   - the sheet's pivotId meta changes (sheet starts/stops being a
//     pivot output sheet — that's a write on sheetsMap), or
//   - the pivot itself is mutated (rows/cols/values/filters/scalars
//     change — that's a write on pivotsMap).
// observeDeep on each map catches all nested writes; combined with the
// JSON-equality guard in computeSnapshot, unrelated writes don't cause
// the snapshot identity to change.
function subscribe(doc: Y.Doc | null, onChange: () => void): () => void {
    if (doc == null) return () => {}
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const pivotsMap = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    const handler = () => onChange()
    sheetsMap.observeDeep(handler)
    pivotsMap.observeDeep(handler)
    return () => {
        sheetsMap.unobserveDeep(handler)
        pivotsMap.unobserveDeep(handler)
    }
}

function computeSnapshot(
    doc: Y.Doc | null,
    sheetId: string,
    state: SnapshotState
): PivotDefinition | null {
    if (doc == null) return state.cache
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (!(meta instanceof Y.Map)) {
        if (state.cache !== null) state.cache = null
        return state.cache
    }
    const pivotId = meta.get(PIVOT_SHEET_KEY)
    if (typeof pivotId !== 'string') {
        if (state.cache !== null) state.cache = null
        return state.cache
    }
    const next = readPivot(doc, pivotId)
    const prev = state.cache
    if (
        prev != null &&
        next != null &&
        JSON.stringify(prev) === JSON.stringify(next)
    ) {
        return prev
    }
    state.cache = next
    return next
}

export function usePivotForSheet(
    doc: Y.Doc | null,
    sheetId: string
): PivotDefinition | null {
    const stateRef = useRef<SnapshotState | null>(null)
    if (stateRef.current == null) stateRef.current = createSnapshotState()
    const state = stateRef.current

    const sub = useCallback(
        (onChange: () => void) => subscribe(doc, onChange),
        [doc]
    )

    const getSnapshot = useCallback(
        (): PivotDefinition | null => computeSnapshot(doc, sheetId, state),
        [doc, sheetId, state]
    )

    return useSyncExternalStore(sub, getSnapshot, getSnapshot)
}

export const __pivotForSheetHookInternals = {
    createSnapshotState,
    subscribe,
    computeSnapshot,
}
