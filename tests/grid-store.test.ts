import { describe, expect, it, vi } from 'vitest'
import { createGridStore, type GridStoreDeps } from '../tinycld/calc/hooks/grid-store'

// The Grid's per-instance store carries selection, edit-session,
// ref-drag, suggestion popover, and menu state. These tests pin the
// state-transition contract so the stable identity of action functions
// — the perf-critical property that lets cells stop re-rendering on
// every keystroke — can't silently regress.
//
// Y.Doc writes flow through GridStoreDeps so this test stays free of
// yjs setup. The deps stub records calls and returns them for
// assertions.

interface StubDeps {
    deps: GridStoreDeps
    writeCalls: Array<{ row: number; col: number; value: string }>
    focusCalls: number
}

function makeStubDeps(opts: { readOnly?: boolean } = {}): StubDeps {
    const writeCalls: StubDeps['writeCalls'] = []
    let focusCalls = 0
    return {
        deps: {
            readOnly: opts.readOnly ?? false,
            writeCell: (row, col, value) => writeCalls.push({ row, col, value }),
            focusActiveInput: () => {
                focusCalls += 1
            },
        },
        writeCalls,
        get focusCalls() {
            return focusCalls
        },
    }
}

describe('createGridStore', () => {
    describe('selectCell', () => {
        it('sets selected and clears edit/pendingSelection', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 })
            store.getState().setEditDraft(1, 1, 'foo')
            store.getState().selectCell({ row: 2, col: 3 })
            const s = store.getState()
            expect(s.selected).toEqual({ row: 2, col: 3 })
            expect(s.editSession).toBeNull()
            expect(s.pendingSelection).toBeNull()
        })

        it('commits an in-flight edit on a different cell before moving', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 })
            store.getState().setEditDraft(1, 1, 'value')
            store.getState().selectCell({ row: 2, col: 2 })
            expect(stub.writeCalls).toEqual([{ row: 1, col: 1, value: 'value' }])
        })

        it('does not commit when readOnly even with an in-flight edit', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            // editCell is a no-op when readOnly, so seed the session
            // directly via setState to simulate an edit that was open
            // before readOnly toggled.
            store.setState({ editSession: { row: 1, col: 1, draft: 'value' } })
            store.getState().selectCell({ row: 2, col: 2 })
            expect(stub.writeCalls).toHaveLength(0)
        })

        it('does not commit when selecting the same cell that is being edited', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 5, col: 5 })
            store.getState().setEditDraft(5, 5, 'mid')
            store.getState().selectCell({ row: 5, col: 5 })
            expect(stub.writeCalls).toHaveLength(0)
            // editSession is cleared because selectCell semantically
            // ends the session, even on the same cell.
            expect(store.getState().editSession).toBeNull()
        })
    })

    describe('extendSelectionTo', () => {
        // Multi-cell selection: anchor stays as `selected`, the
        // additional rectangle lives in `selectionRange`. Normalization
        // (start ≤ end) and single-cell collapse are the contract
        // pinned here.
        it('builds a normalized range from the anchor to the target', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 3 })
            store.getState().extendSelectionTo({ row: 5, col: 7 })
            expect(store.getState().selected).toEqual({ row: 2, col: 3 })
            expect(store.getState().selectionRange).toEqual({
                startRow: 2,
                endRow: 5,
                startCol: 3,
                endCol: 7,
            })
        })

        it('normalizes when the target is above/left of the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 5, col: 7 })
            store.getState().extendSelectionTo({ row: 2, col: 3 })
            expect(store.getState().selectionRange).toEqual({
                startRow: 2,
                endRow: 5,
                startCol: 3,
                endCol: 7,
            })
        })

        it('collapses to null when the extended target equals the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 4, col: 4 })
            store.getState().extendSelectionTo({ row: 4, col: 4 })
            expect(store.getState().selectionRange).toBeNull()
        })

        it('falls through to selectCell when there is no anchor yet', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            expect(store.getState().selected).toEqual({ row: 3, col: 3 })
            expect(store.getState().selectionRange).toBeNull()
        })

        it('commits an in-flight edit on a different cell before extending', () => {
            // Mirror of selectCell's commit-before-move contract.
            // Without this commit, shift-dragging or shift-clicking
            // from a cell currently being edited would silently
            // discard the user's typing.
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().editCell({ row: 1, col: 1 }, 'abc')
            store.getState().setEditDraft(1, 1, 'value')
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            expect(stub.writeCalls).toEqual([{ row: 1, col: 1, value: 'value' }])
            expect(store.getState().editSession).toBeNull()
        })

        it('does not commit when extending to the same cell that is being edited', () => {
            // Anchor and edit target are the same cell: extending to
            // that same cell collapses the range and ends the
            // session without writing (the user hasn't actually
            // moved away).
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 4, col: 4 })
            store.getState().editCell({ row: 4, col: 4 }, 'live')
            store.getState().extendSelectionTo({ row: 4, col: 4 })
            expect(stub.writeCalls).toHaveLength(0)
            expect(store.getState().editSession).toBeNull()
        })

        it('does not commit when readOnly even with an in-flight edit', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            // editCell is a no-op when readOnly, so seed the session
            // directly.
            store.setState({
                selected: { row: 1, col: 1 },
                editSession: { row: 1, col: 1, draft: 'value' },
            })
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            expect(stub.writeCalls).toHaveLength(0)
        })
    })

    describe('drag-select gesture sequence', () => {
        // Mirrors what Cell.tsx's PanResponder does: anchor with
        // selectCell on grant, then call extendSelectionTo on each
        // pointer move. The store should track the changing target
        // cell without losing the anchor.
        it('anchor stays fixed across many extendSelectionTo calls', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            store.getState().extendSelectionTo({ row: 5, col: 5 })
            store.getState().extendSelectionTo({ row: 4, col: 6 })
            expect(store.getState().selected).toEqual({ row: 2, col: 2 })
            expect(store.getState().selectionRange).toEqual({
                startRow: 2,
                endRow: 4,
                startCol: 2,
                endCol: 6,
            })
        })

        it('shrinks the range back when the pointer returns toward the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendSelectionTo({ row: 5, col: 5 })
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            expect(store.getState().selectionRange).toEqual({
                startRow: 1,
                endRow: 3,
                startCol: 1,
                endCol: 3,
            })
        })

        it('collapses to null when the drag ends back on the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 4, col: 4 })
            store.getState().extendSelectionTo({ row: 6, col: 6 })
            store.getState().extendSelectionTo({ row: 4, col: 4 })
            expect(store.getState().selectionRange).toBeNull()
            expect(store.getState().selected).toEqual({ row: 4, col: 4 })
        })
    })

    describe('selection range collapse on single-cell actions', () => {
        // Any action that anchors a single cell — selectCell, editCell,
        // commitEdit — must clear selectionRange so subsequent actions
        // don't accidentally apply across a stale rectangle.
        it('selectCell clears an existing range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            expect(store.getState().selectionRange).not.toBeNull()
            store.getState().selectCell({ row: 5, col: 5 })
            expect(store.getState().selectionRange).toBeNull()
        })

        it('editCell clears an existing range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            store.getState().editCell({ row: 1, col: 1 }, '')
            expect(store.getState().selectionRange).toBeNull()
        })

        it('commitEdit clears an existing range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            store.getState().extendSelectionTo({ row: 3, col: 3 })
            // Seed an edit session inside the range so commitEdit has
            // something to commit.
            store.setState({ editSession: { row: 1, col: 1, draft: 'x' } })
            store.getState().commitEdit(1, 1, 'x')
            expect(store.getState().selectionRange).toBeNull()
        })
    })

    describe('openCellContextMenu range preservation', () => {
        // Right-clicking inside an existing multi-cell range keeps the
        // range alive so range-targeted menu items act on the whole
        // selection. Right-clicking outside collapses to single-cell.
        it('preserves the range when the click lands inside it', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().extendSelectionTo({ row: 4, col: 4 })
            store.getState().openCellContextMenu(3, 3, 0, 0)
            expect(store.getState().selected).toEqual({ row: 2, col: 2 })
            expect(store.getState().selectionRange).toEqual({
                startRow: 2,
                endRow: 4,
                startCol: 2,
                endCol: 4,
            })
        })

        it('collapses the selection when the click lands outside the range', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 2, col: 2 })
            store.getState().extendSelectionTo({ row: 4, col: 4 })
            store.getState().openCellContextMenu(9, 9, 0, 0)
            expect(store.getState().selected).toEqual({ row: 9, col: 9 })
            expect(store.getState().selectionRange).toBeNull()
        })
    })

    describe('editCell', () => {
        it('opens an edit session with the given draft and snaps cursor to end', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 3, col: 4 }, 'hello')
            const s = store.getState()
            expect(s.editSession).toEqual({ row: 3, col: 4, draft: 'hello' })
            expect(s.pendingSelection).toEqual({ start: 5, end: 5 })
            expect(s.activeSurface).toBe('cell')
            expect(store.refs.editCursor.current).toEqual({ start: 5, end: 5 })
        })

        it('is a no-op when readOnly', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'hi')
            expect(store.getState().editSession).toBeNull()
        })
    })

    describe('setEditDraft', () => {
        it('updates the draft', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 })
            store.getState().setEditDraft(1, 1, 'abc')
            expect(store.getState().editSession).toEqual({ row: 1, col: 1, draft: 'abc' })
        })

        it('snaps cursor to end when the session is fresh (different cell)', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'foo')
            // editCell already placed cursor at 3.
            // Simulate the prior session being on a different cell and
            // no editCell call (e.g. an action sequence the formula bar
            // routes through). setEditDraft should snap the cursor.
            store.setState({ editSession: { row: 2, col: 2, draft: '' } })
            store.refs.editCursor.current = { start: 999, end: 999 }
            store.getState().setEditDraft(2, 2, 'hello')
            expect(store.refs.editCursor.current).toEqual({ start: 5, end: 5 })
        })

        it('snaps cursor back into bounds when the new draft is shorter than the cursor position', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'abcdef')
            store.getState().setEditSelection(1, 1, 6, 6)
            // User backspaces past the cursor — cursor.end (6) > new
            // draft length (3), so the action snaps cursor to end.
            store.getState().setEditDraft(1, 1, 'abc')
            expect(store.refs.editCursor.current).toEqual({ start: 3, end: 3 })
        })

        it('leaves cursor alone on in-session edits where cursor is still in bounds', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, 'abc')
            store.getState().setEditSelection(1, 1, 2, 2)
            store.getState().setEditDraft(1, 1, 'abcdef')
            // Cursor was at 2, new draft length 6, in-session — input
            // event will report the new cursor next tick.
            expect(store.refs.editCursor.current).toEqual({ start: 2, end: 2 })
        })
    })

    describe('commitEdit', () => {
        it('writes the value and clears the edit session', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 7, col: 8 })
            store.getState().setEditDraft(7, 8, 'final')
            store.getState().commitEdit(7, 8, 'final')
            expect(stub.writeCalls).toEqual([{ row: 7, col: 8, value: 'final' }])
            expect(store.getState().editSession).toBeNull()
            expect(store.getState().selected).toEqual({ row: 7, col: 8 })
        })

        it('does not write when readOnly', () => {
            const stub = makeStubDeps({ readOnly: true })
            const store = createGridStore(stub.deps)
            store.getState().commitEdit(1, 1, 'x')
            expect(stub.writeCalls).toHaveLength(0)
        })
    })

    describe('cellRefTap', () => {
        it('returns false when there is no active edit session', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            expect(store.getState().cellRefTap(1, 1)).toBe(false)
        })

        it('inserts a ref into the draft when the cursor is in an acceptable position', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            // After editCell with '=', cursor sits at index 1.
            const handled = store.getState().cellRefTap(5, 2) // B5
            expect(handled).toBe(true)
            expect(store.getState().editSession?.draft).toBe('=B5')
            expect(stub.focusCalls).toBe(1)
        })

        it('returns false when the cursor is not in a ref-acceptable position', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            // 'foo' is not a formula, so isRefAcceptable rejects.
            store.getState().editCell({ row: 1, col: 1 }, 'foo')
            expect(store.getState().cellRefTap(5, 2)).toBe(false)
        })
    })

    describe('refDrag lifecycle', () => {
        it('start sets refDrag and inserts the anchor', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            store.getState().cellRefDragStart(5, 2)
            const drag = store.getState().refDrag
            expect(drag).not.toBeNull()
            expect(drag?.anchor).toEqual({ row: 5, col: 2 })
            expect(drag?.end).toEqual({ row: 5, col: 2 })
        })

        it('move updates refDrag.end without changing draft', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            store.getState().cellRefDragStart(5, 2)
            const draftBefore = store.getState().editSession?.draft
            store.getState().cellRefDragMove(7, 4)
            expect(store.getState().refDrag?.end).toEqual({ row: 7, col: 4 })
            // Draft is left alone — the Grid effect is what extends it.
            expect(store.getState().editSession?.draft).toBe(draftBefore)
        })

        it('end clears refDrag and refocuses', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=')
            store.getState().cellRefDragStart(5, 2)
            store.getState().cellRefDragEnd()
            expect(store.getState().refDrag).toBeNull()
            expect(stub.focusCalls).toBe(1)
        })
    })

    describe('suggestion popover', () => {
        it('moveSuggestion wraps modulo total', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().moveSuggestion(1, 3)
            expect(store.getState().suggestionIndex).toBe(1)
            store.getState().moveSuggestion(2, 3)
            expect(store.getState().suggestionIndex).toBe(0)
            store.getState().moveSuggestion(-1, 3)
            expect(store.getState().suggestionIndex).toBe(2)
        })

        it('insertFunction replaces the in-progress token with name(', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            // Cursor is at the end of '=LE' i.e. index 3.
            store.getState().insertFunction('LEFT')
            expect(store.getState().editSession?.draft).toBe('=LEFT(')
        })

        it('dismissSuggestions records the current draft as dismissed', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            store.getState().dismissSuggestions()
            expect(store.getState().dismissedDraft).toBe('=LE')
        })

        it('typing past the dismissed draft re-arms the popover', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            store.getState().dismissSuggestions()
            store.getState().setEditDraft(1, 1, '=LEN')
            expect(store.getState().dismissedDraft).toBeNull()
        })

        it('ending an edit session resets suggestionIndex and dismissedDraft', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().editCell({ row: 1, col: 1 }, '=LE')
            store.getState().moveSuggestion(2, 5)
            store.getState().dismissSuggestions()
            store.getState().cancelEdit()
            expect(store.getState().suggestionIndex).toBe(0)
            expect(store.getState().dismissedDraft).toBeNull()
        })
    })

    describe('subscribe identity contract', () => {
        // Per-cell selectors return primitives so cells can short-
        // circuit on equality. These tests pin the identity behavior
        // of the underlying state slots.
        it('selecting the same cell coordinates produces a NEW selected object', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            store.getState().selectCell({ row: 1, col: 1 })
            const before = store.getState().selected
            store.getState().selectCell({ row: 1, col: 1 })
            const after = store.getState().selected
            // Each selectCell call passes a fresh object; identity
            // changes even when coordinates are equal. The
            // primitive-selector pattern in <Cell> compares isSelected
            // booleans, not the object identity, so this is fine —
            // documented here so a future refactor doesn't try to
            // optimize this away.
            expect(before).not.toBe(after)
            expect(after).toEqual({ row: 1, col: 1 })
        })

        it('action identities are stable across getState() calls', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            const a1 = store.getState().selectCell
            const a2 = store.getState().selectCell
            expect(a1).toBe(a2)
        })

        it('subscriber fires only when watched fields change', () => {
            const stub = makeStubDeps()
            const store = createGridStore(stub.deps)
            const fired = vi.fn()
            // Mirror the Grid's awareness-publish subscriber: only
            // care about selected and editSession.
            store.subscribe((state, prev) => {
                if (state.selected !== prev.selected || state.editSession !== prev.editSession) {
                    fired()
                }
            })
            store.getState().setSuggestionIndex(3)
            expect(fired).toHaveBeenCalledTimes(0)
            store.getState().selectCell({ row: 1, col: 1 })
            expect(fired).toHaveBeenCalledTimes(1)
        })
    })
})
