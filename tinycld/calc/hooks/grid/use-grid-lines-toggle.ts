import { useCallback } from 'react'
import type * as Y from 'yjs'
import { type SheetWithId, setGridLinesVisible } from '../use-y-sheets'

interface UseGridLinesToggleArgs {
    doc: Y.Doc | null
    sheetId: string
    sheet: SheetWithId | null
    readOnly: boolean
}

// The View menu's Gridlines item: whether the active sheet draws
// gridlines, and the action that flips it.
export function useGridLinesToggle({ doc, sheetId, sheet, readOnly }: UseGridLinesToggleArgs) {
    const showGridLines = sheet?.hideGridLines !== true
    const toggleGridLines = useCallback(() => {
        if (readOnly) return
        setGridLinesVisible(doc, sheetId, !showGridLines)
    }, [doc, sheetId, readOnly, showGridLines])
    return { showGridLines, toggleGridLines }
}
