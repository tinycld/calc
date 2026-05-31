import { create } from '@tinycld/core/lib/store'

// PendingSheetSelection carries a desired selection across a sheet
// switch. The per-sheet grid-store instance is recreated when sheetId
// changes (see use-grid-store-instance), so the NameBox can't reach the
// new store directly — it stages the request here, calls
// onActivateSheet, and the new sheet's grid effect consumes it on
// mount.
//
// `range` is optional: when omitted, only the anchor cell selection
// is applied. When present, the selection is extended from start to
// end as if the user had Shift-clicked.
export interface PendingSheetSelection {
    targetSheetId: string
    cell: { row: number; col: number }
    range?: { startRow: number; startCol: number; endRow: number; endCol: number }
}

interface PendingSheetSelectionState {
    pending: PendingSheetSelection | null
    set(pending: PendingSheetSelection): void
    consume(forSheetId: string): PendingSheetSelection | null
    clear(): void
}

export const usePendingSheetSelectionStore = create<PendingSheetSelectionState>((set, get) => ({
    pending: null,
    set: pending => set({ pending }),
    // consume returns the staged selection IFF it targets the supplied
    // sheet, and clears it in the same call. Returning null otherwise
    // means the new sheet doesn't have to do anything.
    consume: forSheetId => {
        const current = get().pending
        if (current == null || current.targetSheetId !== forSheetId) return null
        set({ pending: null })
        return current
    },
    clear: () => set({ pending: null }),
}))
