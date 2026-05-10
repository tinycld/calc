import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import {
    type ColWidths,
    type RowHeights,
    readColWidthsFromMeta,
    readRowHeightsFromMeta,
} from '../lib/dimensions'
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
        const next: SheetWithId[] = ids.map(id => {
            const meta = sheetsMap.get(id)
            return {
                id,
                name: (meta?.get('name') as string) ?? id,
                position: (meta?.get('position') as number) ?? 0,
                rowCount: (meta?.get('rowCount') as number) ?? 0,
                colCount: (meta?.get('colCount') as number) ?? 0,
                colWidths: readColWidthsFromMeta(meta),
                rowHeights: readRowHeightsFromMeta(meta),
            }
        })
        const prev = snapshotRef.current
        if (sameSheets(prev, next)) return prev
        snapshotRef.current = next
        return next
    }, [doc])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// addSheet creates a new sheet in the workbook with a unique id and a
// sensible default name, then returns its id so callers can immediately
// write into it (e.g. CSV import lands rows on the freshly-created
// sheet). Position is the next free slot at the end of the existing
// stack.
//
// Tagged LOCAL_ORIGIN so the realtime undo manager captures the sheet
// creation as one undoable. Idempotency: callers must not pre-supply
// the id; this function picks `sheet${N+1}` where N is the current
// count and bumps until free, preserving the bootstrap convention.
export function addSheet(doc: Y.Doc, options: { name?: string } = {}): string {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    let nextIndex = sheetsMap.size + 1
    while (sheetsMap.has(`sheet${nextIndex}`)) nextIndex++
    const sheetId = `sheet${nextIndex}`
    const name = options.name ?? defaultSheetName(sheetsMap)
    doc.transact(() => {
        const meta = new Y.Map<unknown>()
        meta.set('name', name)
        meta.set('position', sheetsMap.size)
        meta.set('rowCount', 0)
        meta.set('colCount', 0)
        sheetsMap.set(sheetId, meta)
    }, LOCAL_ORIGIN)
    return sheetId
}

function defaultSheetName(sheetsMap: Y.Map<Y.Map<unknown>>): string {
    const taken = new Set<string>()
    sheetsMap.forEach(meta => {
        const name = meta.get('name')
        if (typeof name === 'string') taken.add(name)
    })
    let n = sheetsMap.size + 1
    while (taken.has(`Sheet${n}`)) n++
    return `Sheet${n}`
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
        if (!sameDimensionMap(x.colWidths, y.colWidths)) return false
        if (!sameDimensionMap(x.rowHeights, y.rowHeights)) return false
    }
    return true
}

// Both shapes are sparse Records; equal iff the same set of keys map
// to the same numbers. Order doesn't matter — Object.keys is stable
// per-instance but two equal-content snapshots can come from different
// observers. Cheap because the typical sheet has 0 entries.
function sameDimensionMap(
    a: ColWidths | RowHeights | undefined,
    b: ColWidths | RowHeights | undefined
): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    const ak = Object.keys(a)
    const bk = Object.keys(b)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
        if (a[Number(k)] !== b[Number(k)]) return false
    }
    return true
}
