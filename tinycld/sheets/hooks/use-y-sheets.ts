import { useCallback, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { SHEETS_MAP, type YSheetMeta, ydocSheetIds } from '../lib/y-doc-bootstrap'

export interface SheetWithId extends YSheetMeta {
    id: string
}

// useYSheets returns the array of sheets in the workbook, sorted by
// position. Re-renders when the `sheets` Y.Map mutates (sheet added,
// removed, renamed, resized).
//
// Returns an empty array while doc is null or unbootstrapped — that
// matches the parser's empty-workbook behavior.
export function useYSheets(doc: Y.Doc | null): SheetWithId[] {
    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
            const handler = () => onChange()
            sheetsMap.observeDeep(handler)
            return () => sheetsMap.unobserveDeep(handler)
        },
        [doc]
    )

    // Snapshot caching — same pattern as useYCell. Comparing arrays
    // of metadata cell-by-cell so a write to a single cell elsewhere
    // (which doesn't change sheets) doesn't re-render the whole grid.
    const snapshotRef = useRef<SheetWithId[]>([])
    const getSnapshot = useCallback((): SheetWithId[] => {
        if (doc == null) return snapshotRef.current
        const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const ids = ydocSheetIds(doc)
        const next: SheetWithId[] = ids.map((id) => {
            const meta = sheetsMap.get(id)
            return {
                id,
                name: (meta?.get('name') as string) ?? id,
                position: (meta?.get('position') as number) ?? 0,
                rowCount: (meta?.get('rowCount') as number) ?? 0,
                colCount: (meta?.get('colCount') as number) ?? 0,
            }
        })
        const prev = snapshotRef.current
        if (sameSheets(prev, next)) return prev
        snapshotRef.current = next
        return next
    }, [doc])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function sameSheets(a: SheetWithId[], b: SheetWithId[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        const x = a[i]
        const y = b[i]
        if (
            x.id !== y.id ||
            x.name !== y.name ||
            x.position !== y.position ||
            x.rowCount !== y.rowCount ||
            x.colCount !== y.colCount
        ) {
            return false
        }
    }
    return true
}
