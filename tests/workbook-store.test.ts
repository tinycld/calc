import { beforeEach, describe, expect, it } from 'vitest'
import { cellKey, type WorkbookModel } from '../tinycld/sheets/lib/workbook-types'
import { useWorkbookStore } from '../tinycld/sheets/stores/workbook-store'

function makeWorkbook(): WorkbookModel {
    return {
        sheets: [
            {
                name: 'Sheet1',
                rowCount: 3,
                colCount: 3,
                cells: {
                    [cellKey(1, 1)]: { raw: 'A1', display: 'A1' },
                    [cellKey(1, 2)]: { raw: 'B1', display: 'B1' },
                    [cellKey(2, 1)]: { raw: 'A2', display: 'A2' },
                },
            },
        ],
    }
}

describe('useWorkbookStore', () => {
    beforeEach(() => {
        useWorkbookStore.setState({ workbooks: {} })
    })

    it('seeds and discards a workbook', () => {
        const { setWorkbook, discardWorkbook } = useWorkbookStore.getState()
        setWorkbook('id1', makeWorkbook())
        expect(useWorkbookStore.getState().workbooks.id1).toBeDefined()

        discardWorkbook('id1')
        expect(useWorkbookStore.getState().workbooks.id1).toBeUndefined()
    })

    it('setCell replaces the target cell and leaves siblings reference-equal', () => {
        const { setWorkbook, setCell } = useWorkbookStore.getState()
        setWorkbook('id1', makeWorkbook())

        const before = useWorkbookStore.getState().workbooks.id1.sheets[0]
        const siblingBefore = before.cells[cellKey(1, 2)]
        setCell('id1', 0, 1, 1, 'A1-edited')
        const after = useWorkbookStore.getState().workbooks.id1.sheets[0]

        expect(after.cells[cellKey(1, 1)]).toEqual({ raw: 'A1-edited', display: 'A1-edited' })
        expect(after.cells[cellKey(1, 2)]).toBe(siblingBefore)
        expect(after).not.toBe(before)
    })

    it('setCell with empty string deletes the cell', () => {
        const { setWorkbook, setCell } = useWorkbookStore.getState()
        setWorkbook('id1', makeWorkbook())

        setCell('id1', 0, 1, 1, '')
        const sheet = useWorkbookStore.getState().workbooks.id1.sheets[0]
        expect(sheet.cells[cellKey(1, 1)]).toBeUndefined()
        expect(sheet.cells[cellKey(1, 2)]).toBeDefined()
    })

    it('setCell expands rowCount and colCount when writing past the existing extent', () => {
        const { setWorkbook, setCell } = useWorkbookStore.getState()
        setWorkbook('id1', makeWorkbook())

        setCell('id1', 0, 10, 5, 'far away')
        const sheet = useWorkbookStore.getState().workbooks.id1.sheets[0]
        expect(sheet.rowCount).toBe(10)
        expect(sheet.colCount).toBe(5)
        expect(sheet.cells[cellKey(10, 5)]).toEqual({ raw: 'far away', display: 'far away' })
    })

    it('setCell on a missing workbook is a no-op (no exception)', () => {
        const { setCell } = useWorkbookStore.getState()
        expect(() => setCell('missing', 0, 1, 1, 'x')).not.toThrow()
        expect(useWorkbookStore.getState().workbooks.missing).toBeUndefined()
    })

    it('setCell on a missing sheet index is a no-op', () => {
        const { setWorkbook, setCell } = useWorkbookStore.getState()
        setWorkbook('id1', makeWorkbook())
        const before = useWorkbookStore.getState().workbooks.id1
        setCell('id1', 99, 1, 1, 'x')
        expect(useWorkbookStore.getState().workbooks.id1).toBe(before)
    })

    it('two workbooks are independent', () => {
        const { setWorkbook, setCell } = useWorkbookStore.getState()
        setWorkbook('a', makeWorkbook())
        setWorkbook('b', makeWorkbook())

        setCell('a', 0, 1, 1, 'edit-in-a')
        const a = useWorkbookStore.getState().workbooks.a.sheets[0]
        const b = useWorkbookStore.getState().workbooks.b.sheets[0]
        expect(a.cells[cellKey(1, 1)].display).toBe('edit-in-a')
        expect(b.cells[cellKey(1, 1)].display).toBe('A1')
    })
})
