import { type Shortcut, useRegisterShortcuts } from '@tinycld/core/lib/shortcuts'
import { useMemo } from 'react'
import type { FindActions } from './find/use-find-actions'
import type { FindStoreApi } from './find/use-find-store'
import type { GridStoreApi } from './grid-store'
import type { ClipboardActions } from './use-clipboard'

export interface CalcFormatShortcutCallbacks {
    toggleBold: () => void
    toggleItalic: () => void
    toggleUnderline: () => void
    toggleStrike: () => void
}

export interface UseCalcShortcutsArgs {
    store: GridStoreApi
    clipboard: ClipboardActions
    format: CalcFormatShortcutCallbacks
    find: FindActions
    findStore: FindStoreApi
    readOnly?: boolean
}

// buildCalcShortcuts is the pure shortcut-list factory used by both
// the React hook (memoised) and unit tests. Keeping it standalone
// means tests can assert the registered keybindings, gate predicates,
// and run callbacks without spinning up a React renderer.
export function buildCalcShortcuts({
    store,
    clipboard,
    format,
    find,
    findStore,
    readOnly = false,
}: UseCalcShortcutsArgs): Shortcut[] {
    // The find dialog is also a gate: while it's open, regular
    // grid shortcuts (copy/cut/paste/format) suspend so the user
    // can't accidentally trip them while typing in the find input.
    // The find dialog's own shortcuts (next/prev match, close) run
    // with allowInInputs:true so they keep firing.
    const when = () => {
        const s = store.getState()
        if (findStore.getState().isOpen) return false
        return s.selected != null && s.editSession == null
    }
    const whenFindOpen = () => findStore.getState().isOpen

    return [
        {
            id: 'calc.clipboard.copy',
            keys: '$mod+c',
            scope: 'global',
            group: 'Calc',
            description: 'Copy',
            when,
            run: () => {
                void clipboard.copy()
            },
        },
        {
            id: 'calc.clipboard.cut',
            keys: '$mod+x',
            scope: 'global',
            group: 'Calc',
            description: 'Cut',
            when: () => when() && !readOnly,
            run: () => {
                void clipboard.cut()
            },
        },
        {
            id: 'calc.clipboard.cancelCut',
            keys: 'Escape',
            scope: 'global',
            group: 'Calc',
            description: 'Cancel cut',
            when: () => store.getState().cutPending,
            run: () => {
                store.getState().clearClipboardMarker()
            },
        },
        {
            id: 'calc.clipboard.paste',
            keys: '$mod+v',
            scope: 'global',
            group: 'Calc',
            description: 'Paste',
            when: () => when() && !readOnly,
            run: () => {
                void clipboard.paste('all')
            },
        },
        {
            id: 'calc.clipboard.pasteValues',
            keys: '$mod+Shift+v',
            scope: 'global',
            group: 'Calc',
            description: 'Paste values only',
            when: () => when() && !readOnly,
            run: () => {
                void clipboard.paste('values')
            },
        },
        {
            id: 'calc.clipboard.pasteFormulas',
            keys: '$mod+Alt+v',
            scope: 'global',
            group: 'Calc',
            description: 'Paste formulas only',
            when: () => when() && !readOnly,
            run: () => {
                void clipboard.paste('formulas')
            },
        },
        {
            id: 'calc.clipboard.pasteFormat',
            keys: '$mod+Alt+Shift+v',
            scope: 'global',
            group: 'Calc',
            description: 'Paste format only',
            when: () => when() && !readOnly,
            run: () => {
                void clipboard.paste('format')
            },
        },
        {
            id: 'calc.clipboard.pasteTranspose',
            keys: '$mod+Alt+t',
            scope: 'global',
            group: 'Calc',
            description: 'Paste transposed',
            when: () => when() && !readOnly,
            run: () => {
                void clipboard.paste('transpose')
            },
        },
        {
            id: 'calc.format.bold',
            keys: '$mod+b',
            scope: 'global',
            group: 'Calc',
            description: 'Bold',
            when: () => when() && !readOnly,
            run: () => {
                format.toggleBold()
            },
        },
        {
            id: 'calc.format.italic',
            keys: '$mod+i',
            scope: 'global',
            group: 'Calc',
            description: 'Italic',
            when: () => when() && !readOnly,
            run: () => {
                format.toggleItalic()
            },
        },
        {
            id: 'calc.format.underline',
            keys: '$mod+u',
            scope: 'global',
            group: 'Calc',
            description: 'Underline',
            when: () => when() && !readOnly,
            run: () => {
                format.toggleUnderline()
            },
        },
        {
            id: 'calc.format.strike',
            // Cmd+Shift+X mirrors the Google Sheets convention. Cmd+5
            // (Sheets' default) is intercepted by some browsers as a
            // tab-switch shortcut, so we stay clear of it.
            keys: '$mod+Shift+x',
            scope: 'global',
            group: 'Calc',
            description: 'Strikethrough',
            when: () => when() && !readOnly,
            run: () => {
                format.toggleStrike()
            },
        },
        {
            id: 'calc.find.open',
            keys: '$mod+f',
            scope: 'global',
            group: 'Calc',
            description: 'Find',
            allowInInputs: true,
            when: () => store.getState().editSession == null,
            run: () => {
                find.openFind()
            },
        },
        {
            id: 'calc.find.openReplace',
            keys: '$mod+Shift+h',
            scope: 'global',
            group: 'Calc',
            description: 'Find and replace',
            allowInInputs: true,
            when: () => !readOnly && store.getState().editSession == null,
            run: () => {
                find.openReplace()
            },
        },
        {
            id: 'calc.find.next',
            keys: '$mod+g',
            scope: 'global',
            group: 'Calc',
            description: 'Next match',
            allowInInputs: true,
            when: whenFindOpen,
            run: () => {
                find.nextMatch()
            },
        },
        {
            id: 'calc.find.prev',
            keys: '$mod+Shift+g',
            scope: 'global',
            group: 'Calc',
            description: 'Previous match',
            allowInInputs: true,
            when: whenFindOpen,
            run: () => {
                find.prevMatch()
            },
        },
    ]
}

export function useCalcShortcuts({
    store,
    clipboard,
    format,
    find,
    findStore,
    readOnly = false,
}: UseCalcShortcutsArgs) {
    const shortcuts = useMemo<Shortcut[]>(
        () => buildCalcShortcuts({ store, clipboard, format, find, findStore, readOnly }),
        [store, clipboard, format, find, findStore, readOnly]
    )

    useRegisterShortcuts(shortcuts)
}
