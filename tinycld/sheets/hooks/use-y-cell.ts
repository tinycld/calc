import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { yCellKey } from '../lib/y-cell-key'
import { CELLS_MAP, type YCellValue } from '../lib/y-doc-bootstrap'

// useYCell subscribes to one Y.Map cell entry and re-renders the caller
// only when that specific cell changes. Internally uses
// useSyncExternalStore against the parent map's `observe` event,
// filtering to keys this hook cares about.
//
// Returns null when the cell does not exist in the Y.Doc (i.e. empty
// cell).
export function useYCell(doc: Y.Doc | null, sheetId: string, row: number, col: number): YCellValue | null {
    const key = yCellKey(sheetId, row, col)

    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
            // We observe two layers: the parent map (for adds/replacements
            // of *this* key) and the nested cell map (for in-place
            // raw/display field changes). When the cell is replaced
            // wholesale, we re-attach the nested observer.
            let nested: Y.Map<unknown> | undefined = cellsMap.get(key)
            const nestedHandler = () => onChange()
            nested?.observe(nestedHandler)

            const parentHandler = (event: Y.YMapEvent<Y.Map<unknown>>) => {
                if (!event.keysChanged.has(key)) return
                if (nested != null) {
                    try {
                        nested.unobserve(nestedHandler)
                    } catch {
                        // already detached or removed; tolerate
                    }
                }
                nested = cellsMap.get(key)
                nested?.observe(nestedHandler)
                onChange()
            }
            cellsMap.observe(parentHandler)

            return () => {
                cellsMap.unobserve(parentHandler)
                if (nested != null) {
                    try {
                        nested.unobserve(nestedHandler)
                    } catch {
                        // ignore
                    }
                }
            }
        },
        [doc, key]
    )

    // Stable snapshot caching — useSyncExternalStore re-invokes
    // getSnapshot on every render and infinite-loops if we hand back a
    // fresh object each time. We memoize on field-equality so the
    // identity stays stable across renders that didn't actually change
    // the cell.
    const snapshotRef = useRef<YCellValue | null>(null)
    const getSnapshot = useCallback((): YCellValue | null => {
        if (doc == null) {
            snapshotRef.current = null
            return null
        }
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(key)
        if (cell == null) {
            snapshotRef.current = null
            return null
        }
        const next = readYCellValue(cell)
        const prev = snapshotRef.current
        if (prev != null && prev.raw === next.raw && prev.display === next.display && prev.formula === next.formula) {
            return prev
        }
        snapshotRef.current = next
        return next
    }, [doc, key])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function readYCellValue(cell: Y.Map<unknown>): YCellValue {
    // The xlsx parser writes raw as `string | number | boolean | Date
    // | null` while the live editor writes plain strings. Guard the
    // read so the rendered display always sees a string.
    const raw = cell.get('raw')
    const display = cell.get('display')
    const formula = cell.get('formula')
    return {
        raw: typeof raw === 'string' ? raw : raw == null ? '' : String(raw),
        display: typeof display === 'string' ? display : display == null ? '' : String(display),
        formula: typeof formula === 'string' ? formula : undefined,
    }
}

// setYCell is the write-side counterpart — wraps a Y.Map.set in a
// transact so a single Enter generates one Yjs update and one undo
// step. The LOCAL_ORIGIN tag is what the realtime undo manager
// allowlists; without it the edit would not be captured for undo.
// Empty input deletes the cell.
export function setYCell(doc: Y.Doc, sheetId: string, row: number, col: number, input: string): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    doc.transact(() => {
        if (input === '') {
            cellsMap.delete(key)
            return
        }
        // Continuing the no-coercion rule: raw and display are the same
        // string the user typed.
        const cell = new Y.Map<unknown>()
        cell.set('raw', input)
        cell.set('display', input)
        cellsMap.set(key, cell)
    }, LOCAL_ORIGIN)
}
