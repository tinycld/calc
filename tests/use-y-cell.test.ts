import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { setYCell, setYCellStyle } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import { CELLS_MAP, STYLE_KEY } from '../tinycld/calc/lib/y-doc-bootstrap'

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

    it('parent observer fires on insert; subsequent edits observed via the nested cell map', () => {
        // setYCell mutates the existing cell Y.Map in place rather
        // than replacing it (so style/font/etc. survive value edits).
        // The Grid hook (useYCell) handles this by attaching a deep
        // observer on the nested cell map; the parent CELLS_MAP only
        // sees insert / delete events.
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const watchedKey = yCellKey('sheet1', 1, 1)
        let parentFires = 0
        cellsMap.observe((event) => {
            if (event.keysChanged.has(watchedKey)) parentFires++
        })

        setYCell(doc, 'sheet1', 1, 1, 'A1')
        expect(parentFires).toBe(1)

        // Re-edit the same cell: parent observer does NOT fire again —
        // the change is on the nested map's `raw`/`display` keys.
        let nestedFires = 0
        cellsMap.get(watchedKey)?.observe(() => {
            nestedFires++
        })
        setYCell(doc, 'sheet1', 1, 1, 'A1-edited')
        expect(parentFires).toBe(1)
        expect(nestedFires).toBe(1)
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

    it('setYCell on an existing styled cell preserves the style entry', () => {
        // Regression: setYCell must mutate raw/display in place rather
        // than replacing the whole cell Y.Map, otherwise typing into a
        // bolded cell silently drops the bold.
        const doc = new Y.Doc()
        setYCell(doc, 'sheet1', 1, 1, 'before')
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCell(doc, 'sheet1', 1, 1, 'after')

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(cell?.get('raw')).toBe('after')
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(true)
    })
})

describe('setYCellStyle', () => {
    it('writes a partial style under cell.style as nested Y.Maps', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        expect(cell).toBeDefined()
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        expect(style).toBeDefined()
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(true)
    })

    it('deep-merges across calls — adding italic does not drop bold', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { italic: true } })

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(true)
        expect(font?.get('italic')).toBe(true)
    })

    it('overwriting a key yields the new value', () => {
        const doc = new Y.Doc()
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: false } })

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey('sheet1', 1, 1))
        const style = cell?.get(STYLE_KEY) as Y.Map<unknown> | undefined
        const font = style?.get('font') as Y.Map<unknown> | undefined
        expect(font?.get('bold')).toBe(false)
    })

    it('creates the cell Y.Map on demand when style is set on an empty cell', () => {
        const doc = new Y.Doc()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        expect(cellsMap.has(yCellKey('sheet1', 1, 1))).toBe(false)
        setYCellStyle(doc, 'sheet1', 1, 1, { font: { bold: true } })
        expect(cellsMap.has(yCellKey('sheet1', 1, 1))).toBe(true)
    })
})
