import { useMemo } from 'react'
import type { PrintSelection } from '../../lib/print/snapshot'
import { usePrintDialog } from '../use-print-dialog'
import { useGridStore } from '../use-grid-store'

export interface GridPrintDialog {
    isOpen: boolean
    open: () => void
    close: () => void
    // The print dialog's "current selection" scope only makes sense
    // for a true rectangular selection — a lone anchor cell falls
    // through to null so the dialog hides the option.
    currentSelection: PrintSelection | null
}

export function useGridPrintDialog(sheetId: string): GridPrintDialog {
    const isOpen = usePrintDialog(s => s.isOpen)
    const open = usePrintDialog(s => s.open)
    const close = usePrintDialog(s => s.close)
    const selectionRange = useGridStore(s => s.selectionRange)
    const currentSelection = useMemo<PrintSelection | null>(() => {
        if (selectionRange == null) return null
        return {
            sheetId,
            rect: {
                startRow: selectionRange.startRow,
                startCol: selectionRange.startCol,
                endRow: selectionRange.endRow,
                endCol: selectionRange.endCol,
            },
        }
    }, [selectionRange, sheetId])

    return { isOpen, open, close, currentSelection }
}
