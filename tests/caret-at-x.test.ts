import { describe, expect, it } from 'vitest'
import { caretIndexAtX } from '../tinycld/calc/lib/caret-at-x'

// A fake monospace font: every character is 10px wide.
const measure = (s: string) => s.length * 10

describe('caretIndexAtX', () => {
    it('puts the caret at the nearest character boundary of left-aligned text', () => {
        // Text starts at x=0: boundaries at 0, 10, 20, ...
        expect(caretIndexAtX('Hello', 0, 200, 'left', measure)).toBe(0)
        expect(caretIndexAtX('Hello', 14, 200, 'left', measure)).toBe(1)
        expect(caretIndexAtX('Hello', 16, 200, 'left', measure)).toBe(2)
    })

    it('puts the caret at the end for a click past the text', () => {
        expect(caretIndexAtX('Hello', 180, 200, 'left', measure)).toBe(5)
    })

    it('measures right-aligned text from the right edge', () => {
        // 50px of text in a 200px box starts at x=150.
        expect(caretIndexAtX('Hello', 150, 200, 'right', measure)).toBe(0)
        expect(caretIndexAtX('Hello', 172, 200, 'right', measure)).toBe(2)
        expect(caretIndexAtX('Hello', 20, 200, 'right', measure)).toBe(0)
    })

    it('measures centered text from its centered start', () => {
        // 50px of text in a 200px box starts at x=75.
        expect(caretIndexAtX('Hello', 100, 200, 'center', measure)).toBe(3)
    })

    it('is 0 for empty text', () => {
        expect(caretIndexAtX('', 50, 200, 'left', measure)).toBe(0)
    })
})
