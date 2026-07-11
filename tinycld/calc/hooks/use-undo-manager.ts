import {
    type UndoManagerState,
    useYUndoManager,
} from '@tinycld/core/lib/realtime/use-y-undo-manager'
import { useCallback } from 'react'
import type * as Y from 'yjs'
import { CELLS_MAP, NAMED_RANGES_MAP, SHEETS_MAP } from '../lib/y-doc-bootstrap'

// useUndoManager scopes Y.UndoManager + Cmd-Z/Cmd-Shift-Z to the
// calc-specific cells + sheets + named-ranges Y.Maps. Returns the same
// state object the core hook exposes — { canUndo, canRedo, undo, redo }
// — so the toolbar buttons and keyboard shortcuts share a single
// manager.
export function useUndoManager(doc: Y.Doc | null): UndoManagerState {
    const scope = useCallback((): Y.AbstractType<unknown>[] => {
        if (doc == null) return []
        // Y.Map<T> is AbstractType<YMapEvent<T>>, and AbstractType's event
        // param is invariant (via its _eH field), so a Y.Map is not
        // structurally assignable to AbstractType<unknown> even though it
        // extends AbstractType — a known yjs .d.ts limitation. Y.UndoManager
        // itself accepts any Y type at runtime, so widen through the base.
        return [doc.getMap(CELLS_MAP), doc.getMap(SHEETS_MAP), doc.getMap(NAMED_RANGES_MAP)].map(
            m => m as unknown as Y.AbstractType<unknown>
        )
    }, [doc])

    return useYUndoManager(doc, { scope })
}

export type { UndoManagerState }
