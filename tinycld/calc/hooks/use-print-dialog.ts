import { create } from '@tinycld/core/lib/store'

// Transient UI state for the Print dialog. Not persisted — printing
// is a one-shot action, and the dialog defaults reset every time the
// user opens it. Modeled as a Zustand store rather than React state
// so the toolbar's PrintButton, the Grid's <PrintDialog>, and any
// keyboard shortcut path can read/write the open flag without prop
// drilling.
export interface PrintDialogState {
    isOpen: boolean
    open: () => void
    close: () => void
}

export const usePrintDialog = create<PrintDialogState>(set => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}))
