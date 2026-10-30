import { describe, expect, it } from 'vitest'
import { overflowRoom } from '../tinycld/calc/lib/text-overflow'

// Columns are 100px wide; offsets are prefix sums.
const colOffsets = Float64Array.from({ length: 11 }, (_, i) => i * 100)

describe('overflowRoom', () => {
    it('is the width of the empty cells to the right, up to the next filled cell', () => {
        const filled = new Set(['1:1', '1:4'])
        const isFilled = (r: number, c: number) => filled.has(`${r}:${c}`)
        expect(overflowRoom(1, 1, colOffsets, 10, isFilled)).toBe(200)
    })

    it('is 0 when the next cell is filled', () => {
        const isFilled = () => true
        expect(overflowRoom(1, 1, colOffsets, 10, isFilled)).toBe(0)
    })

    it('stops at the last column it may cross', () => {
        const isFilled = (_r: number, c: number) => c === 1
        expect(overflowRoom(1, 1, colOffsets, 3, isFilled)).toBe(200)
    })
})
