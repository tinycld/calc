import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { Table } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import * as Y from 'yjs'
import { addSheet } from '../../hooks/use-y-sheets'
import { writePivot } from '../../lib/pivot/y-binding'
import { usePivotPanelStore } from '../../lib/stores/pivot-panel-store'
import { PIVOT_SHEET_KEY, SHEETS_MAP } from '../../lib/y-doc-bootstrap'
import { ToolbarButton } from '../toolbar/ToolbarButton'
import {
    buildInitialPivotDefinition,
    makePivotId,
    type NewPivotFormValues,
} from './new-pivot-dialog-helpers'
import { NewPivotDialog } from './NewPivotDialog'

export interface PivotInsertButtonProps {
    // Live Y.Doc. Null while the realtime room is still handshaking — the
    // button stays disabled until the doc is ready so we never write
    // into a placeholder doc.
    doc: Y.Doc | null
    defaultSourceRange: string
    defaultTargetSheetName: string
    // Switches the workbook to the freshly-created pivot output sheet.
    // The host screen routes this through `router.replace(orgHref(...))`
    // so the URL stays the source of truth for active sheet.
    onActivateSheet: (sheetId: string) => void
    disabled?: boolean
}

// Toolbar entry point for creating a new pivot table. Opens the
// NewPivotDialog to collect source range + target sheet name; on Create,
// it (1) adds a new sheet for the output, (2) writes the pivot def into
// the doc, (3) marks the new sheet as that pivot's target via the
// pivotId meta key, (4) activates the new sheet, and (5) opens the
// side panel so the user can drag fields in. Steps 1-3 run inside a
// single doc.transact so a peer never observes a half-created pivot.
export function PivotInsertButton({
    doc,
    defaultSourceRange,
    defaultTargetSheetName,
    onActivateSheet,
    disabled,
}: PivotInsertButtonProps) {
    const [visible, setVisible] = useState(false)
    const open = useCallback(() => setVisible(true), [])
    const close = useCallback(() => setVisible(false), [])

    const onCreate = useCallback(
        ({ sourceRange, targetSheetName }: NewPivotFormValues) => {
            if (doc == null) return
            // addSheet runs its own LOCAL_ORIGIN transact and returns
            // the new sheetId synchronously. We then open a SECOND
            // transact for the pivot write + meta tag — yjs nests
            // transactions cleanly (the inner becomes a no-op
            // boundary), so this is safe; the undo manager treats the
            // two writes as separate steps which is the right behavior
            // (undoing the pivot keeps the sheet, undoing again drops
            // the sheet).
            const newSheetId = addSheet(doc, { name: targetSheetName })
            const pivotId = makePivotId()
            const def = buildInitialPivotDefinition({
                id: pivotId,
                sourceRange,
                targetSheetName,
            })
            doc.transact(() => {
                writePivot(doc, def)
                const meta = doc
                    .getMap<Y.Map<unknown>>(SHEETS_MAP)
                    .get(newSheetId)
                if (meta instanceof Y.Map) {
                    meta.set(PIVOT_SHEET_KEY, pivotId)
                }
            }, LOCAL_ORIGIN)
            setVisible(false)
            onActivateSheet(newSheetId)
            usePivotPanelStore.getState().open(newSheetId)
        },
        [doc, onActivateSheet]
    )

    return (
        <>
            <ToolbarButton
                icon={Table}
                label="Insert pivot table"
                disabled={disabled || doc == null}
                onPress={open}
            />
            <NewPivotDialog
                visible={visible}
                defaultSourceRange={defaultSourceRange}
                defaultTargetSheetName={defaultTargetSheetName}
                onCancel={close}
                onCreate={onCreate}
            />
        </>
    )
}
