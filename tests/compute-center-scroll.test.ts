import { describe, expect, it } from 'vitest'
import { computeCenterScroll } from '../tinycld/calc/hooks/grid/use-grid-viewport'

// Build a Float64Array of prefix sums from per-cell sizes. e.g.
// buildOffsets([100, 100, 100]) → Float64Array [0, 100, 200, 300].
function buildOffsets(sizes: number[]): Float64Array {
    const out = new Float64Array(sizes.length + 1)
    for (let i = 0; i < sizes.length; i++) {
        out[i + 1] = out[i] + sizes[i]
    }
    return out
}

describe('computeCenterScroll', () => {
    const colOffsets = buildOffsets(Array(20).fill(100)) // 20 cols × 100px = 2000px
    const rowOffsets = buildOffsets(Array(40).fill(30)) // 40 rows × 30px  = 1200px

    it('returns nulls when cell is already fully visible (no freeze)', () => {
        // Viewport is 600x300 at scroll (200, 60). Visible content
        // range: x ∈ [200, 800], y ∈ [60, 360]. Cell at row 4, col 5:
        // rect (400..500, 90..120) — inside the visible range.
        const plan = computeCenterScroll({
            row: 4,
            col: 5,
            colOffsets,
            rowOffsets,
            frozenRows: 0,
            frozenCols: 0,
            viewportWidth: 600,
            viewportHeight: 300,
            scrollX: 200,
            scrollY: 60,
        })
        expect(plan).toEqual({ x: null, y: null })
    })

    it('centers the cell on both axes when off-screen', () => {
        // Cell at row 30, col 15 → rect (1400..1500, 870..900).
        // Viewport 600x300 starting at (0,0): visible (0..600, 0..300).
        // Cell is offscreen on both axes; center x = 1400 + 50 - 300 =
        // 1150, center y = 870 + 15 - 150 = 735. Clamped to valid
        // range [0, 1400] and [0, 900] respectively.
        const plan = computeCenterScroll({
            row: 30,
            col: 15,
            colOffsets,
            rowOffsets,
            frozenRows: 0,
            frozenCols: 0,
            viewportWidth: 600,
            viewportHeight: 300,
            scrollX: 0,
            scrollY: 0,
        })
        expect(plan.x).toBe(1150)
        expect(plan.y).toBe(735)
    })

    it('clamps scroll to [0, maxScroll] so we never overscroll past content edges', () => {
        // Cell at very bottom-right (row 40, col 20). Centering would
        // ask for x = 2000 - 50 - 300 = 1650 but maxScroll = 2000 -
        // 600 = 1400.
        const plan = computeCenterScroll({
            row: 40,
            col: 20,
            colOffsets,
            rowOffsets,
            frozenRows: 0,
            frozenCols: 0,
            viewportWidth: 600,
            viewportHeight: 300,
            scrollX: 0,
            scrollY: 0,
        })
        expect(plan.x).toBe(1400)
        expect(plan.y).toBe(900)
    })

    it('skips the axis when the cell is on the frozen side of that axis', () => {
        // Frozen row 1 (height 30). Cell at row 1, col 15 is in the
        // frozen-row strip → always visible vertically; only x might
        // need scrolling.
        const plan = computeCenterScroll({
            row: 1,
            col: 15,
            colOffsets,
            rowOffsets,
            frozenRows: 1,
            frozenCols: 0,
            viewportWidth: 600,
            viewportHeight: 300,
            scrollX: 0,
            scrollY: 200,
        })
        expect(plan.y).toBeNull()
        // Cell (1400..1500) is outside the visible range [0..600]
        // → scrolls horizontally; center math identical to no-freeze
        // case since frozenCols = 0.
        expect(plan.x).toBe(1150)
    })

    it('returns both nulls for a fully-frozen cell (no scroll needed)', () => {
        const plan = computeCenterScroll({
            row: 1,
            col: 1,
            colOffsets,
            rowOffsets,
            frozenRows: 1,
            frozenCols: 1,
            viewportWidth: 600,
            viewportHeight: 300,
            scrollX: 500,
            scrollY: 500,
        })
        expect(plan).toEqual({ x: null, y: null })
    })

    it('uses unfrozen-content-local coords so visibility test accounts for the frozen overlay', () => {
        // Frozen row 1 (30px tall). Unfrozen viewport vertical span =
        // 300 - 30 = 270. Cell at row 2 (absolute y range 30..60). In
        // content-local coords that's y ∈ [0, 30]. At scrollY=0 it's
        // at the top of the unfrozen area — fully visible, no scroll.
        const plan = computeCenterScroll({
            row: 2,
            col: 1,
            colOffsets,
            rowOffsets,
            frozenRows: 1,
            frozenCols: 0,
            viewportWidth: 600,
            viewportHeight: 300,
            scrollX: 0,
            scrollY: 0,
        })
        expect(plan.y).toBeNull()
        expect(plan.x).toBeNull()
    })

    it('returns nulls when the viewport has not been laid out yet', () => {
        // viewport.onBodyLayout hasn't fired: width/height = 0. We
        // can't reason about visibility — defer the scroll.
        const plan = computeCenterScroll({
            row: 30,
            col: 15,
            colOffsets,
            rowOffsets,
            frozenRows: 0,
            frozenCols: 0,
            viewportWidth: 0,
            viewportHeight: 0,
            scrollX: 0,
            scrollY: 0,
        })
        expect(plan).toEqual({ x: null, y: null })
    })

    it('scrolls when the cell is only partially clipped', () => {
        // Cell at row 1, col 7: rect (600..700, 0..30). Viewport
        // 600x300 at scrollX=200, scrollY=0: visible x range
        // [200, 800]. Cell fits. Move scrollX to 250: visible
        // [250, 850]; cell still fits. Move scrollX to 50: visible
        // [50, 650]; cell right edge (700) > 650, so partial clip →
        // scroll.
        const plan = computeCenterScroll({
            row: 1,
            col: 7,
            colOffsets,
            rowOffsets,
            frozenRows: 0,
            frozenCols: 0,
            viewportWidth: 600,
            viewportHeight: 30, // exactly one row tall, so y axis is fully visible
            scrollX: 50,
            scrollY: 0,
        })
        // Center the cell: cellCenter = 650, target = 650 - 300 = 350.
        expect(plan.x).toBe(350)
    })
})
