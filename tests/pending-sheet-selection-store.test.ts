import { beforeEach, describe, expect, it } from 'vitest'
import { usePendingSheetSelectionStore } from '../tinycld/calc/lib/stores/pending-sheet-selection-store'

beforeEach(() => {
    usePendingSheetSelectionStore.getState().clear()
})

describe('usePendingSheetSelectionStore', () => {
    it('starts empty', () => {
        expect(usePendingSheetSelectionStore.getState().pending).toBeNull()
    })

    it('set + consume round-trips the staged selection', () => {
        usePendingSheetSelectionStore.getState().set({
            targetSheetId: 'sheet2',
            cell: { row: 4, col: 2 },
        })
        const got = usePendingSheetSelectionStore.getState().consume('sheet2')
        expect(got).toEqual({
            targetSheetId: 'sheet2',
            cell: { row: 4, col: 2 },
        })
        // Consume clears: a second call returns null.
        expect(usePendingSheetSelectionStore.getState().consume('sheet2')).toBeNull()
    })

    it('consume returns null when the staged selection targets a different sheet', () => {
        usePendingSheetSelectionStore.getState().set({
            targetSheetId: 'sheet2',
            cell: { row: 1, col: 1 },
        })
        // sheet1 mounts first → its consume must NOT pick up the
        // sheet2-bound selection.
        expect(usePendingSheetSelectionStore.getState().consume('sheet1')).toBeNull()
        // The pending entry survives so sheet2's mount still picks it up.
        expect(usePendingSheetSelectionStore.getState().pending?.targetSheetId).toBe('sheet2')
    })

    it('preserves the range field when present', () => {
        usePendingSheetSelectionStore.getState().set({
            targetSheetId: 'sheet3',
            cell: { row: 1, col: 1 },
            range: { startRow: 1, startCol: 1, endRow: 5, endCol: 3 },
        })
        const got = usePendingSheetSelectionStore.getState().consume('sheet3')
        expect(got?.range).toEqual({ startRow: 1, startCol: 1, endRow: 5, endCol: 3 })
    })

    it('clear resets to null', () => {
        usePendingSheetSelectionStore.getState().set({
            targetSheetId: 'sheet1',
            cell: { row: 1, col: 1 },
        })
        usePendingSheetSelectionStore.getState().clear()
        expect(usePendingSheetSelectionStore.getState().pending).toBeNull()
    })

    it('latest set wins', () => {
        const store = usePendingSheetSelectionStore.getState()
        store.set({ targetSheetId: 'sheet1', cell: { row: 1, col: 1 } })
        store.set({ targetSheetId: 'sheet2', cell: { row: 9, col: 9 } })
        const got = usePendingSheetSelectionStore.getState().consume('sheet2')
        expect(got?.cell).toEqual({ row: 9, col: 9 })
        // sheet1's staged value was overwritten, not queued.
        expect(usePendingSheetSelectionStore.getState().consume('sheet1')).toBeNull()
    })
})
