import { describe, expect, it } from 'vitest'
import {
    effectiveRange,
    forEachCellInRange,
    rangeCellCount,
    rangeContainsCell,
} from '../tinycld/calc/lib/selection-range'

// CellRange helpers are dependency-free utilities used by the toolbar
// callbacks, the cell context menu, and the grid store. The contract
// pinned here is what the rest of the multi-select machinery assumes
// (always normalized, single-cell ranges allowed, end-inclusive).

describe('rangeContainsCell', () => {
    it('includes both endpoints (inclusive bounds)', () => {
        const range = { startRow: 2, startCol: 3, endRow: 4, endCol: 5 }
        expect(rangeContainsCell(range, 2, 3)).toBe(true)
        expect(rangeContainsCell(range, 4, 5)).toBe(true)
    })

    it('rejects coordinates outside the range', () => {
        const range = { startRow: 2, startCol: 3, endRow: 4, endCol: 5 }
        expect(rangeContainsCell(range, 1, 4)).toBe(false)
        expect(rangeContainsCell(range, 5, 4)).toBe(false)
        expect(rangeContainsCell(range, 3, 2)).toBe(false)
        expect(rangeContainsCell(range, 3, 6)).toBe(false)
    })

    it('treats a single-cell range as containing only that cell', () => {
        const range = { startRow: 7, startCol: 8, endRow: 7, endCol: 8 }
        expect(rangeContainsCell(range, 7, 8)).toBe(true)
        expect(rangeContainsCell(range, 7, 9)).toBe(false)
    })
})

describe('effectiveRange', () => {
    it('returns the explicit range when one is set', () => {
        const range = { startRow: 1, startCol: 1, endRow: 3, endCol: 3 }
        expect(effectiveRange({ row: 2, col: 2 }, range)).toEqual(range)
    })

    it('synthesizes a single-cell range from the anchor when no range is set', () => {
        expect(effectiveRange({ row: 4, col: 5 }, null)).toEqual({
            startRow: 4,
            endRow: 4,
            startCol: 5,
            endCol: 5,
        })
    })

    it('returns null when there is no selection at all', () => {
        expect(effectiveRange(null, null)).toBeNull()
    })

    it('prefers the explicit range even when it disagrees with the anchor', () => {
        // The store guarantees the anchor lies inside the range, but
        // the helper should not enforce or transform — it just returns
        // what it was given. Anchor placement is the store's job.
        const range = { startRow: 1, startCol: 1, endRow: 5, endCol: 5 }
        expect(effectiveRange({ row: 99, col: 99 }, range)).toEqual(range)
    })
})

describe('rangeCellCount', () => {
    it('counts both endpoints (single cell = 1)', () => {
        expect(rangeCellCount({ startRow: 3, startCol: 4, endRow: 3, endCol: 4 })).toBe(1)
    })

    it('multiplies width by height', () => {
        expect(rangeCellCount({ startRow: 1, startCol: 1, endRow: 3, endCol: 4 })).toBe(12)
    })
})

describe('forEachCellInRange', () => {
    it('visits every cell in row-major order', () => {
        const visits: [number, number][] = []
        forEachCellInRange({ startRow: 1, startCol: 1, endRow: 2, endCol: 3 }, (r, c) => {
            visits.push([r, c])
        })
        expect(visits).toEqual([
            [1, 1],
            [1, 2],
            [1, 3],
            [2, 1],
            [2, 2],
            [2, 3],
        ])
    })

    it('visits a single cell once when range is degenerate', () => {
        const visits: [number, number][] = []
        forEachCellInRange({ startRow: 9, startCol: 7, endRow: 9, endCol: 7 }, (r, c) => {
            visits.push([r, c])
        })
        expect(visits).toEqual([[9, 7]])
    })
})
