// Pure classifier for the cell's onKeyDown handler. Keeps the
// branching out of Cell.tsx so it can be unit-tested without a render
// and so the rules stay in one place when more keys grow into the
// "selected, not editing" handler.
//
// Inputs: just the bits of a keydown event we actually look at —
// `key` and the three modifier flags. Output is a discriminated
// action the caller dispatches to the grid store.

export interface CellKeyEvent {
    key?: string
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
}

export type CellKeyAction =
    | { kind: 'ignore' }
    | { kind: 'clear' }
    | { kind: 'startEdit'; seed: string }

// classifyCellKey returns the action to take for a keypress on a
// focused, non-editing cell. Modifier-combo keys (Cmd+B, Ctrl+C, …)
// always ignore here — they belong to the global shortcut registry.
//
// Printable single-character keys trigger startEdit with the typed
// character as the seed, matching Sheets / Excel's "start typing to
// replace" behavior. Shift on its own is fine: shifted letters
// already come through e.key as their uppercase form, so we don't
// need to special-case it.
export function classifyCellKey(e: CellKeyEvent): CellKeyAction {
    const key = e.key
    if (key == null) return { kind: 'ignore' }
    if (key === 'Delete' || key === 'Backspace') return { kind: 'clear' }
    if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'ignore' }
    // Single-character printable keys only. Filters Enter/Tab/F2/
    // ArrowUp (length > 1), control chars (key < ' '), and pure-
    // modifier events ('Shift', 'Control'). " " (space) is included
    // — it's a valid first character of a cell value.
    if (key.length !== 1 || key < ' ') return { kind: 'ignore' }
    return { kind: 'startEdit', seed: key }
}
