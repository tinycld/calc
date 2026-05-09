import { useYUndoManager } from '@tinycld/core/lib/realtime/use-y-undo-manager'
import { useCallback } from 'react'
import type * as Y from 'yjs'
import { CELLS_MAP, SHEETS_MAP } from '../lib/y-doc-bootstrap'

// useUndoManager scopes Y.UndoManager + Cmd-Z/Cmd-Shift-Z to the
// calc-specific cells + sheets Y.Maps. All other behavior (origin
// filtering, captureTimeout, keyboard wiring) lives in the core hook.
export function useUndoManager(doc: Y.Doc | null): void {
    const scope = useCallback(() => {
        if (doc == null) return []
        return [doc.getMap(CELLS_MAP), doc.getMap(SHEETS_MAP)]
    }, [doc])

    useYUndoManager(doc, { scope })
}
