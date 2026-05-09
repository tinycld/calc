import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { CellStyle } from '../lib/workbook-types'
import { yCellKey } from '../lib/y-cell-key'
import { buildStyleYMap, CELLS_MAP, readStyleFromYMap, STYLE_KEY, type YCellValue } from '../lib/y-doc-bootstrap'

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
            //
            // observeDeep on the cell Y.Map catches changes inside the
            // nested style Y.Map without us having to re-attach a third
            // layer of observers when style is added/removed.
            let nested: Y.Map<unknown> | undefined = cellsMap.get(key)
            const nestedHandler = () => onChange()
            nested?.observeDeep(nestedHandler)

            const parentHandler = (event: Y.YMapEvent<Y.Map<unknown>>) => {
                if (!event.keysChanged.has(key)) return
                if (nested != null) {
                    try {
                        nested.unobserveDeep(nestedHandler)
                    } catch {
                        // already detached or removed; tolerate
                    }
                }
                nested = cellsMap.get(key)
                nested?.observeDeep(nestedHandler)
                onChange()
            }
            cellsMap.observe(parentHandler)

            return () => {
                cellsMap.unobserve(parentHandler)
                if (nested != null) {
                    try {
                        nested.unobserveDeep(nestedHandler)
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
        if (
            prev != null &&
            prev.raw === next.raw &&
            prev.display === next.display &&
            prev.formula === next.formula &&
            sameStyle(prev.style, next.style)
        ) {
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
    const style = readStyleFromYMap(cell)
    return {
        raw: typeof raw === 'string' ? raw : raw == null ? '' : String(raw),
        display: typeof display === 'string' ? display : display == null ? '' : String(display),
        formula: typeof formula === 'string' ? formula : undefined,
        style,
    }
}

// sameStyle is a structural-equality check used by the snapshot cache
// to avoid handing back a fresh object identity when no style attribute
// actually changed. JSON.stringify is fine here — partial style
// objects are tiny (a handful of keys) and we never store functions or
// circular references.
function sameStyle(a: CellStyle | undefined, b: CellStyle | undefined): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    return JSON.stringify(a) === JSON.stringify(b)
}

// setYCell is the write-side counterpart — wraps a Y.Map.set in a
// transact so a single Enter generates one Yjs update and one undo
// step. The LOCAL_ORIGIN tag is what the realtime undo manager
// allowlists; without it the edit would not be captured for undo.
// Empty input deletes the cell.
//
// When the cell already exists, mutate raw/display/formula in place
// rather than replacing the whole Y.Map. Replacing would discard the
// nested style Y.Map (and its CRDT history), so typing into a bolded
// cell would silently drop the bold.
export function setYCell(doc: Y.Doc, sheetId: string, row: number, col: number, input: string): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    doc.transact(() => {
        if (input === '') {
            cellsMap.delete(key)
            return
        }
        const existing = cellsMap.get(key)
        if (existing != null) {
            // Continuing the no-coercion rule: raw and display are the
            // same string the user typed. Style and any other tracked
            // attributes are left intact.
            existing.set('raw', input)
            existing.set('display', input)
            // A value-only edit isn't a formula; clear any prior
            // formula so reads don't see stale state.
            if (existing.has('formula')) {
                existing.delete('formula')
            }
            return
        }
        const cell = new Y.Map<unknown>()
        cell.set('raw', input)
        cell.set('display', input)
        cellsMap.set(key, cell)
    }, LOCAL_ORIGIN)
}

// setYCellStyle deep-merges a partial CellStyle patch onto the cell at
// (sheetId, row, col). Cells that don't exist yet are created with no
// raw/display, just style — toggling bold on an empty cell is valid
// and persists as soon as the cell gets a value, or on its own as a
// pure-style entry on save.
//
// The patch is merged group-by-group, key-by-key. Setting a value to
// `undefined` (or omitting the key) leaves the prior value alone;
// setting it to a defined value overwrites. This matches the snapshot
// semantics: only what's present is sent, only what's present is
// applied.
export function setYCellStyle(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    patch: CellStyle
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const key = yCellKey(sheetId, row, col)
    doc.transact(() => {
        let cell = cellsMap.get(key)
        if (cell == null) {
            cell = new Y.Map<unknown>()
            cellsMap.set(key, cell)
        }
        let styleMap = cell.get(STYLE_KEY)
        if (!(styleMap instanceof Y.Map)) {
            styleMap = buildStyleYMap(patch)
            if (styleMap != null) {
                cell.set(STYLE_KEY, styleMap)
            }
            return
        }
        for (const groupKey of Object.keys(patch) as (keyof CellStyle)[]) {
            const groupPatch = patch[groupKey]
            if (groupPatch == null) continue
            if (typeof groupPatch === 'string') {
                styleMap.set(groupKey, groupPatch)
                continue
            }
            let groupMap = styleMap.get(groupKey)
            if (!(groupMap instanceof Y.Map)) {
                groupMap = new Y.Map<unknown>()
                styleMap.set(groupKey, groupMap)
            }
            for (const [k, v] of Object.entries(groupPatch)) {
                if (v == null) continue
                groupMap.set(k, v as unknown)
            }
        }
    }, LOCAL_ORIGIN)
}
