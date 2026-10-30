import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { yCellKey } from '../lib/y-cell-key'
import { CELLS_MAP } from '../lib/y-doc-bootstrap'

// useFilledCells answers "does this cell show a value?" for the text
// overflow layout. It re-renders its caller only when a cell turns
// filled or empty — not on every edit — so the grid body is not
// re-rendered per keystroke. A cell with only a style (a border on an
// empty cell) is empty: text may run across it, as in Sheets.
export function useFilledCells(doc: Y.Doc | null, sheetId: string) {
    const versionRef = useRef(0)
    const filledRef = useRef<Set<string>>(new Set())

    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
            const prefix = `${sheetId}:`
            const filled = new Set<string>()
            cellsMap.forEach((cell, key) => {
                if (key.startsWith(prefix) && isFilled(cell)) filled.add(key)
            })
            filledRef.current = filled
            versionRef.current++
            const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
                let changed = false
                for (const key of changedKeys(events, cellsMap)) {
                    if (!key.startsWith(prefix)) continue
                    const cell = cellsMap.get(key)
                    const now = cell != null && isFilled(cell)
                    if (now === filled.has(key)) continue
                    if (now) filled.add(key)
                    else filled.delete(key)
                    changed = true
                }
                if (!changed) return
                versionRef.current++
                onChange()
            }
            cellsMap.observeDeep(handler)
            return () => cellsMap.unobserveDeep(handler)
        },
        [doc, sheetId]
    )
    const version = useSyncExternalStore(subscribe, () => versionRef.current)

    return useMemo(() => {
        const filled = filledRef.current
        return {
            version,
            isFilled: (row: number, col: number) => filled.has(yCellKey(sheetId, row, col)),
        }
    }, [version, sheetId])
}

function isFilled(cell: Y.Map<unknown>): boolean {
    const kind = cell.get('kind')
    if (kind == null) return false
    const raw = cell.get('raw')
    return !(kind === 'string' && (raw === '' || raw == null))
}

// changedKeys lists the cell keys an observeDeep batch touched: keys
// added or removed on the cells map itself, and the cell whose own map
// changed for nested events.
function changedKeys(
    events: Y.YEvent<Y.AbstractType<unknown>>[],
    cellsMap: Y.Map<Y.Map<unknown>>
): Set<string> {
    const keys = new Set<string>()
    for (const event of events) {
        if (event.target === cellsMap) {
            for (const key of event.changes.keys.keys()) keys.add(key)
            continue
        }
        const head = event.path[0]
        if (typeof head === 'string') keys.add(head)
    }
    return keys
}
