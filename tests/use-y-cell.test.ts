import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

// useYCell ties a React component to one Y.Map cell entry via
// useSyncExternalStore. Mounting the hook here would require a React
// renderer and our vitest setup mocks react-native heavily, so these
// tests exercise the underlying data-flow contract directly:
//
//   - setYCell writes to the Y.Doc atomically
//   - empty input deletes the cell
//   - cellsMap.observe fires once per setYCell call (so the hook
//     re-renders the right number of times in production)
//   - changes to *other* cells do NOT fire observers for the watched key
//
// The last point is the crucial perf invariant: with hundreds of cells
// visible, only the changed cell's hook should re-render.

describe('setYCell + cellsMap observe', () => {
    it('writes a cell as a nested Y.Map with raw and display strings', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 2, 3, 'hello')
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 2, 3))
        expect(cell?.get('raw')).toBe('hello')
        expect(cell?.get('display')).toBe('hello')
    })

    it('empty input deletes the cell', () => {
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 2, 3, 'hello')
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        expect(cellsMap.has(yCellKey('sheet1', 2, 3))).toBe(true)

        setYCell(doc, 'sheet1', 2, 3, '')
        expect(cellsMap.has(yCellKey('sheet1', 2, 3))).toBe(false)
    })

    it('observer fires for the watched key when its cell is set', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const watchedKey = yCellKey('sheet1', 1, 1)
        let firedForWatched = 0
        cellsMap.observe((event) => {
            if (event.keysChanged.has(watchedKey)) firedForWatched++
        })

        setYCell(doc, 'sheet1', 1, 1, 'A1')
        expect(firedForWatched).toBe(1)

        setYCell(doc, 'sheet1', 1, 1, 'A1-edited')
        expect(firedForWatched).toBe(2)
    })

    it('observer does NOT fire for the watched key when an unrelated cell changes', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const watchedKey = yCellKey('sheet1', 1, 1)
        let firedForWatched = 0
        cellsMap.observe((event) => {
            if (event.keysChanged.has(watchedKey)) firedForWatched++
        })

        setYCell(doc, 'sheet1', 5, 5, 'unrelated')
        setYCell(doc, 'sheet1', 1, 2, 'sibling-row')
        setYCell(doc, 'sheet2', 1, 1, 'different-sheet')

        expect(firedForWatched).toBe(0)
    })

    it('one setYCell produces exactly one Yjs update (for clean undo grouping)', () => {
        const doc = new Y.Doc()
        let updates = 0
        doc.on('update', () => {
            updates++
        })
        setYCell(doc, 'sheet1', 1, 1, 'one')
        expect(updates).toBe(1)
    })
})
