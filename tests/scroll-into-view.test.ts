import { describe, expect, it } from 'vitest'
import { scrollIntoView } from '../tinycld/calc/lib/scroll-into-view'

// Ten 100px columns and ten 20px rows; offsets are prefix sums.
const colOffsets = Float64Array.from({ length: 11 }, (_, i) => i * 100)
const rowOffsets = Float64Array.from({ length: 11 }, (_, i) => i * 20)
const view = { scrollX: 0, scrollY: 0, width: 300, height: 100 }

describe('scrollIntoView', () => {
    it('does not scroll for a cell already in view', () => {
        expect(scrollIntoView({ row: 2, col: 2 }, colOffsets, rowOffsets, view, 0, 0)).toEqual({})
    })

    it('scrolls right just far enough to show a cell past the right edge', () => {
        expect(scrollIntoView({ row: 1, col: 5 }, colOffsets, rowOffsets, view, 0, 0)).toEqual({
            x: 200,
        })
    })

    it('scrolls left to a cell before the visible area', () => {
        const scrolled = { ...view, scrollX: 400 }
        expect(scrollIntoView({ row: 1, col: 2 }, colOffsets, rowOffsets, scrolled, 0, 0)).toEqual({
            x: 100,
        })
    })

    it('scrolls down to a row below the visible area', () => {
        expect(scrollIntoView({ row: 8, col: 1 }, colOffsets, rowOffsets, view, 0, 0)).toEqual({
            y: 60,
        })
    })

    it('measures past frozen columns and rows, and never scrolls for a frozen cell', () => {
        // Columns A:B frozen (200px): the scroll area starts at C.
        expect(scrollIntoView({ row: 1, col: 1 }, colOffsets, rowOffsets, view, 1, 2)).toEqual({})
        expect(scrollIntoView({ row: 1, col: 6 }, colOffsets, rowOffsets, view, 1, 2)).toEqual({
            x: 100,
        })
    })

    it('does not scroll before the area has been measured', () => {
        const unmeasured = { scrollX: 0, scrollY: 0, width: 0, height: 0 }
        expect(
            scrollIntoView({ row: 8, col: 8 }, colOffsets, rowOffsets, unmeasured, 0, 0)
        ).toEqual({})
    })
})
