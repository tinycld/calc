import type { Awareness } from 'y-protocols/awareness'
import type { GridStoreApi } from '../../hooks/grid-store'

// subscribeAwarenessToStore wires the local Zustand store to the
// y-protocols Awareness instance. Any change to selection or
// editSession triggers a setLocalState call so peers see it. Returns
// an unsubscribe function, intended to be called by useEffect's
// cleanup.
//
// This replaces the ~10 publishLocal calls that used to be scattered
// through every action — one subscribe, one wire, all changes flow
// through it. The {sheetId, selection, editing} shape is the contract
// pinned by tests/awareness-roundtrip.test.ts.
export function subscribeAwarenessToStore(
    store: GridStoreApi,
    awareness: Awareness,
    sheetId: string
): () => void {
    const publish = () => {
        const { selected, editSession } = store.getState()
        const local = awareness.getLocalState() ?? {}
        awareness.setLocalState({
            ...local,
            sheetId,
            selection: selected,
            editing:
                editSession != null
                    ? { row: editSession.row, col: editSession.col, draft: editSession.draft }
                    : null,
        })
    }
    publish()
    return store.subscribe((state, prev) => {
        if (state.selected !== prev.selected || state.editSession !== prev.editSession) {
            publish()
        }
    })
}
