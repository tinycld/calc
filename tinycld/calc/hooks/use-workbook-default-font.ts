import { useCallback, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import {
    readWorkbookDefaultFont,
    WORKBOOK_MAP,
    type WorkbookFont,
} from '../lib/workbook-default-font'

const NO_FONT: WorkbookFont = {}

// useWorkbookDefaultFont returns the workbook's default font (name and
// size in points), or an empty object when the file sets none. The
// snapshot keeps its identity until the name or size changes, so a
// write elsewhere in the workbook map does not re-render the grid.
export function useWorkbookDefaultFont(doc: Y.Doc | null): WorkbookFont {
    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const map = doc.getMap<unknown>(WORKBOOK_MAP)
            map.observeDeep(onChange)
            return () => map.unobserveDeep(onChange)
        },
        [doc]
    )

    const snapshotRef = useRef<WorkbookFont>(NO_FONT)
    const getSnapshot = useCallback((): WorkbookFont => {
        if (doc == null) return NO_FONT
        const next = readWorkbookDefaultFont(doc)
        const prev = snapshotRef.current
        if (prev.name === next.name && prev.size === next.size) return prev
        snapshotRef.current = next
        return next
    }, [doc])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
