import { describe, expect, it } from 'vitest'
import { createGridStore, type GridStoreDeps } from '../tinycld/calc/hooks/grid-store'

// Selection scope is the discriminator that drives the format-control
// dispatch path: 'cells' is the default body selection, while 'row'
// (and later 'column'/'sheet') indicate header-click selections that
// route style writes to per-axis sheet metadata. Body interactions
// reset to 'cells'.

function makeStubDeps(opts: { readOnly?: boolean } = {}): GridStoreDeps {
    return {
        readOnly: opts.readOnly ?? false,
        writeCell: () => {},
        focusActiveInput: () => {},
        applyStructuralMutation: () => {},
    }
}

describe('selectRow', () => {
    it('sets scope to row, anchor to (row, 1), and a full-row range', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        const s = store.getState()
        expect(s.selectionScope).toBe('row')
        expect(s.selected).toEqual({ row: 7, col: 1 })
        expect(s.selectionRange).toEqual({
            startRow: 7,
            endRow: 7,
            startCol: 1,
            endCol: 26,
        })
    })

    it('clamps endCol to at least 1 even when colCount is 0', () => {
        // Defensive: a freshly-created sheet may briefly report
        // colCount=0 before bootstrap. selectRow should produce a
        // valid range regardless.
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(2, 0)
        expect(store.getState().selectionRange?.endCol).toBe(1)
    })

    it('clears any in-flight edit session', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().editCell({ row: 1, col: 1 })
        store.getState().setEditDraft(1, 1, 'foo')
        store.getState().selectRow(7, 5)
        expect(store.getState().editSession).toBeNull()
    })
})

describe('selectionScope reset by body interactions', () => {
    it('selectCell resets scope from row back to cells', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        expect(store.getState().selectionScope).toBe('row')
        store.getState().selectCell({ row: 3, col: 3 })
        expect(store.getState().selectionScope).toBe('cells')
    })

    it('extendSelectionTo resets scope from row back to cells', () => {
        const store = createGridStore(makeStubDeps())
        // Seed an anchor first so extendSelectionTo follows the
        // range-extend branch, not the no-anchor fallback.
        store.getState().selectCell({ row: 1, col: 1 })
        store.getState().selectRow(7, 26)
        expect(store.getState().selectionScope).toBe('row')
        store.getState().extendSelectionTo({ row: 5, col: 5 })
        expect(store.getState().selectionScope).toBe('cells')
    })

    it('editCell resets scope to cells', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        store.getState().editCell({ row: 1, col: 1 })
        expect(store.getState().selectionScope).toBe('cells')
    })

    it('commitEdit resets scope to cells', () => {
        const store = createGridStore(makeStubDeps())
        store.getState().selectRow(7, 26)
        store.getState().commitEdit(1, 1, 'value')
        expect(store.getState().selectionScope).toBe('cells')
    })
})

describe('initial state', () => {
    it('starts in scope=cells', () => {
        const store = createGridStore(makeStubDeps())
        expect(store.getState().selectionScope).toBe('cells')
    })
})
