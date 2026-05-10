import { type Shortcut, useRegisterShortcuts } from '@tinycld/core/lib/shortcuts'
import { useMemo } from 'react'
import type { GridStoreApi } from './grid-store'
import type { ClipboardActions } from './use-clipboard'

// Calc-grid keyboard shortcuts. Phase 3 wires Cmd+C / Cmd+X / Cmd+V
// plus the four paste-special variants to the orchestrating
// useClipboard hook.
//
// Scope choice: 'global' with a `when` callback that gates on "a cell
// is selected and no cell editor is open". The shortcut system also
// gates on `inInput` automatically — when the cell editor's TextInput
// has focus, Cmd+V should paste *into the input* as ordinary text, not
// run our cell-paste action. `allowInInputs: false` (the default)
// gives us that behaviour for free.
//
// We don't introduce a `'grid'` scope to the global scope union because
// (a) there's only one Grid mounted at a time on calc screens, (b) the
// inInput + selected-gate combination already disambiguates calc from
// other apps, and (c) adding scopes touches the core type and isn't
// worth the churn for Phase 3.
//
// Cut (Cmd+X) is registered here but is wired up in Phase 4 when the
// marching-ants visual + source-clear-on-paste machinery lands. For
// Phase 3 it falls back to a plain copy so users don't see a no-op
// keybinding.

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
    readOnly = false,
}: UseCalcShortcutsArgs): Shortcut[] {
    // A shortcut should fire only when:
    //   - a cell is selected (otherwise there's nothing to copy
    //     from or paste into), and
    //   - no cell editor is active (handled by allowInInputs:false
    //     against the TextInput, plus this explicit check for the
    //     editor's draft state held in the store rather than DOM
    //     focus).
    const when = () => {
        const s = store.getState()
        return s.selected != null && s.editSession == null
    }

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
            // Only fires when a cut is actually pending; otherwise
            // Esc passes through to other handlers (cancel edit,
            // close menu, etc.).
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
    ]
}

export function useCalcShortcuts({
    store,
    clipboard,
    format,
    readOnly = false,
}: UseCalcShortcutsArgs) {
    const shortcuts = useMemo<Shortcut[]>(
        () => buildCalcShortcuts({ store, clipboard, format, readOnly }),
        [store, clipboard, format, readOnly]
    )

    useRegisterShortcuts(shortcuts)
}
