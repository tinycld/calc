import { useCallback } from 'react'
import type * as Y from 'yjs'
import { toggleCellFontAttr } from '../../components/grid/style-helpers'
import { useGridStore } from '../use-grid-store'
import { useYCell } from '../use-y-cell'

export interface GridToolbarToggles {
    selectedRow: number | null
    selectedCol: number | null
    hasSelection: boolean
    isBold: boolean
    isItalic: boolean
    onToggleBold: () => void
    onToggleItalic: () => void
    // Exposed for the FormulaBar value derivation. Subscribes to the
    // selected cell so the bar updates when the cell changes.
    selectedCellValue: ReturnType<typeof useYCell>
}

interface UseGridToolbarTogglesArgs {
    doc: Y.Doc | null
    sheetId: string
    readOnly: boolean
}

// Subscribes to the selected cell's row/col, derives bold/italic
// active state from the live useYCell value, and binds the two
// toggle callbacks. The selected cell value is also returned because
// the formula bar wants it for its display value — computing once
// here avoids a second useYCell subscription elsewhere.
export function useGridToolbarToggles({
    doc,
    sheetId,
    readOnly,
}: UseGridToolbarTogglesArgs): GridToolbarToggles {
    const selectedRow = useGridStore(s => s.selected?.row ?? null)
    const selectedCol = useGridStore(s => s.selected?.col ?? null)
    const hasSelection = selectedRow != null && selectedCol != null

    // Passing 0,0 when there's no selection is intentional — useYCell
    // observes a synthetic key and produces null, which downstream
    // consumers treat as "no value".
    const selectedCellValue = useYCell(doc, sheetId, selectedRow ?? 0, selectedCol ?? 0)

    const isBold = hasSelection && selectedCellValue?.style?.font?.bold === true
    const isItalic = hasSelection && selectedCellValue?.style?.font?.italic === true

    const onToggleBold = useCallback(() => {
        if (!hasSelection || readOnly) return
        toggleCellFontAttr(doc, sheetId, selectedRow, selectedCol, 'bold')
    }, [doc, sheetId, selectedRow, selectedCol, hasSelection, readOnly])

    const onToggleItalic = useCallback(() => {
        if (!hasSelection || readOnly) return
        toggleCellFontAttr(doc, sheetId, selectedRow, selectedCol, 'italic')
    }, [doc, sheetId, selectedRow, selectedCol, hasSelection, readOnly])

    return {
        selectedRow,
        selectedCol,
        hasSelection,
        isBold,
        isItalic,
        onToggleBold,
        onToggleItalic,
        selectedCellValue,
    }
}
