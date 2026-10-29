import { describe, expect, it } from 'vitest'
import { resolveFontFamily } from '../tinycld/calc/lib/font-family'

// xlsx files name Office fonts (Calibri, Cambria) that most machines do
// not have. A bare unknown family makes the browser fall back to its
// default serif font, so every cell needs a fallback of the right kind.

describe('resolveFontFamily — web', () => {
    it('gives Calibri a metric-compatible fallback and a sans-serif generic', () => {
        expect(resolveFontFamily('Calibri', 'web')).toBe('Calibri, Carlito, sans-serif')
    })

    it('quotes names with spaces and keeps serif fonts serif', () => {
        expect(resolveFontFamily('Times New Roman', 'web')).toBe(
            '"Times New Roman", "Liberation Serif", Times, serif'
        )
    })

    it('keeps monospace fonts monospace', () => {
        expect(resolveFontFamily('Courier New', 'web')).toBe(
            '"Courier New", "Liberation Mono", Courier, monospace'
        )
    })

    it('falls back to sans-serif for an unknown font', () => {
        expect(resolveFontFamily('Inter', 'web')).toBe('Inter, sans-serif')
    })
})

describe('resolveFontFamily — native', () => {
    it('uses the system font for a sans-serif font that may not be installed', () => {
        expect(resolveFontFamily('Calibri', 'ios')).toBeUndefined()
        expect(resolveFontFamily('Calibri', 'android')).toBeUndefined()
    })

    it('maps serif and monospace fonts to a family each platform has', () => {
        expect(resolveFontFamily('Cambria', 'ios')).toBe('Times New Roman')
        expect(resolveFontFamily('Cambria', 'android')).toBe('serif')
        expect(resolveFontFamily('Consolas', 'ios')).toBe('Courier New')
        expect(resolveFontFamily('Consolas', 'android')).toBe('monospace')
    })
})
