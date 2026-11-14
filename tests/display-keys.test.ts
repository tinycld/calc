import { describe, expect, it } from 'vitest'
import { displayKeys } from '../tinycld/calc/components/dialogs/display-keys'

describe('displayKeys', () => {
    it('joins single-modifier combos with +', () => {
        expect(displayKeys('$mod+c', false)).toBe('Ctrl+C')
        expect(displayKeys('$mod+c', true)).toBe('⌘+C')
    })

    it('joins multi-modifier combos with +', () => {
        expect(displayKeys('$mod+Shift+x', false)).toBe('Ctrl+Shift+X')
        expect(displayKeys('$mod+Shift+x', true)).toBe('⌘+⇧+X')
    })

    it('joins chord sequences with a space between combos', () => {
        expect(displayKeys('t i', false)).toBe('t i')
        expect(displayKeys('t i', true)).toBe('t i')
    })

    it('passes through bare keys without modifiers', () => {
        expect(displayKeys('Escape', false)).toBe('Esc')
        expect(displayKeys('Escape', true)).toBe('Esc')
    })

    it('translates Enter to its glyph', () => {
        expect(displayKeys('$mod+Enter', false)).toBe('Ctrl+↵')
        expect(displayKeys('$mod+Enter', true)).toBe('⌘+↵')
    })

    it('formatKeys collapses Shift+? to ?; the renderer does not re-introduce a +', () => {
        // Shift is implicit in the glyph — the displayed form is the bare key.
        expect(displayKeys('Shift+?', false)).toBe('?')
        expect(displayKeys('Shift+?', true)).toBe('?')
    })
})
