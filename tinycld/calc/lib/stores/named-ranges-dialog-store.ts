import { create } from '@tinycld/core/lib/store'
import type { NamedRangeKey } from '../named-ranges/types'

// useNamedRangesDialogStore drives the workbook's Name Manager dialog.
// State:
//   isOpen          — whether the modal is rendered.
//   mode            — 'list' (table view) or 'edit' (form view).
//   editingKey      — key being edited; null when creating a new entry.
//   prefillName     — pre-fills the name input in edit mode (used by
//                     the Name Box "type a name + Enter" shortcut).
//   prefillExpression — pre-fills the expression input (used by
//                     "Define name from selection" and the Name Box
//                     typing path).
//   prefillScope    — pre-fills the scope picker; null means workbook-
//                     global, a sheet id means sheet-local.
//
// Both prefill* fields are cleared when the dialog closes or returns
// to list mode so a subsequent open doesn't reuse stale values.
interface NamedRangesDialogState {
    isOpen: boolean
    mode: 'list' | 'edit'
    editingKey: NamedRangeKey | null
    prefillName: string | null
    prefillExpression: string | null
    prefillScope: string | null | undefined // undefined = no prefill, null = global, string = sheetId

    openList(): void
    openCreate(prefill?: { name?: string; expression?: string; scope?: string | null }): void
    openEdit(key: NamedRangeKey): void
    goToList(): void
    close(): void
}

export const useNamedRangesDialogStore = create<NamedRangesDialogState>(set => ({
    isOpen: false,
    mode: 'list',
    editingKey: null,
    prefillName: null,
    prefillExpression: null,
    prefillScope: undefined,

    openList: () =>
        set({
            isOpen: true,
            mode: 'list',
            editingKey: null,
            prefillName: null,
            prefillExpression: null,
            prefillScope: undefined,
        }),
    openCreate: prefill =>
        set({
            isOpen: true,
            mode: 'edit',
            editingKey: null,
            prefillName: prefill?.name ?? null,
            prefillExpression: prefill?.expression ?? null,
            prefillScope: prefill?.scope ?? undefined,
        }),
    openEdit: key =>
        set({
            isOpen: true,
            mode: 'edit',
            editingKey: key,
            prefillName: null,
            prefillExpression: null,
            prefillScope: undefined,
        }),
    goToList: () =>
        set({
            mode: 'list',
            editingKey: null,
            prefillName: null,
            prefillExpression: null,
            prefillScope: undefined,
        }),
    close: () =>
        set({
            isOpen: false,
            mode: 'list',
            editingKey: null,
            prefillName: null,
            prefillExpression: null,
            prefillScope: undefined,
        }),
}))
