import { useCallback } from 'react'
import type * as Y from 'yjs'
import { toggleCellFontAttrInRange } from '../../components/grid/style-helpers'
import { effectiveRange } from '../../lib/selection-range'
import { useGridStore, useGridStoreApi } from '../use-grid-store'
import { useYCell } from '../use-y-cell'

export interface GridToolbarToggles {
    selectedRow: number | null
    selectedCol: number | null
    hasSelection: boolean
    isBold: boolean
    isItalic: boolean
    isUnderline: boolean
    isStrike: boolean
    onToggleBold: () => void
    onToggleItalic: () => void
    onToggleUnderline: () => void
    onToggleStrike: () => void
    // Exposed for the FormulaBar value derivation. Subscribes to the
    // selected cell so the bar updates when the cell changes.
    selectedCellValue: ReturnType<typeof useYCell>
}

interface UseGridToolbarTogglesArgs {
    doc: Y.Doc | null
    sheetId: string
    readOnly: boolean
}

// Subscribes to the anchor cell's row/col, derives bold/italic/strike
// active state from the live useYCell value of the anchor, and binds
// the three toggle callbacks.
//
// Read state (isBold/isItalic/isStrike) reflects the anchor cell only
// — that's the cell visibly outlined and the natural reference for
// indicators. Toggle actions, however, route through
// toggleCellFontAttrInRange which iterates the whole effective range
// with mixed-toggle semantics (any-off → all-on, otherwise all-off).
//
// Importantly, this hook does NOT subscribe to selectionRange. Each
// drag-move produces a new range object, and a subscriber would
// re-run on every pointermove — propagating new toolbar prop
// identities into <Toolbar> and re-rendering its full subtree (every
// menu, color picker, font stepper). The toggle callbacks instead
// read the live range via store.getState() at call time.
//
// The selected cell value is returned because the formula bar wants
// it for its display value — computing once here avoids a second
// useYCell subscription elsewhere.
export function useGridToolbarToggles({
    doc,
    sheetId,
    readOnly,
}: UseGridToolbarTogglesArgs): GridToolbarToggles {
    const selectedRow = useGridStore(s => s.selected?.row ?? null)
    const selectedCol = useGridStore(s => s.selected?.col ?? null)
    const hasSelection = selectedRow != null && selectedCol != null
    const store = useGridStoreApi()

    // Passing 0,0 when there's no selection is intentional — useYCell
    // observes a synthetic key and produces null, which downstream
    // consumers treat as "no value".
    const selectedCellValue = useYCell(doc, sheetId, selectedRow ?? 0, selectedCol ?? 0)

    const isBold = hasSelection && selectedCellValue?.style?.font?.bold === true
    const isItalic = hasSelection && selectedCellValue?.style?.font?.italic === true
    const isUnderline = hasSelection && selectedCellValue?.style?.font?.underline === true
    const isStrike = hasSelection && selectedCellValue?.style?.font?.strike === true

    const toggleAttr = useCallback(
        (attr: 'bold' | 'italic' | 'underline' | 'strike') => {
            if (readOnly || doc == null) return
            const state = store.getState()
            const anchor = state.selected
            if (anchor == null) return
            const range = effectiveRange(anchor, state.selectionRange)
            if (range == null) return
            toggleCellFontAttrInRange(doc, sheetId, range, attr)
        },
        [doc, sheetId, readOnly, store]
    )

    const onToggleBold = useCallback(() => toggleAttr('bold'), [toggleAttr])
    const onToggleItalic = useCallback(() => toggleAttr('italic'), [toggleAttr])
    const onToggleUnderline = useCallback(() => toggleAttr('underline'), [toggleAttr])
    const onToggleStrike = useCallback(() => toggleAttr('strike'), [toggleAttr])

    return {
        selectedRow,
        selectedCol,
        hasSelection,
        isBold,
        isItalic,
        isUnderline,
        isStrike,
        onToggleBold,
        onToggleItalic,
        onToggleUnderline,
        onToggleStrike,
        selectedCellValue,
    }
}
