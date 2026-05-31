import { describe, expect, it } from 'vitest'
import {
    applyNameInsertion,
    filterSuggestions,
    parseFunctionToken,
    type SuggestionItem,
} from '../tinycld/calc/lib/formula/autocomplete'

describe('filterSuggestions', () => {
    it('returns names ahead of functions when both prefix-match', () => {
        const out = filterSuggestions(['TAN', 'TAX', 'TRUE'], ['TaxRate', 'TruthValue'], 'T')
        const labels = out.map(o => `${o.kind}:${o.name}`)
        // Names come first (sorted), then functions (sorted).
        expect(labels[0]).toMatch(/^name:/)
        // Ensure both kinds are represented.
        expect(out.some(o => o.kind === 'function')).toBe(true)
        expect(out.some(o => o.kind === 'name')).toBe(true)
    })

    it('returns [] on empty prefix', () => {
        expect(filterSuggestions(['SUM'], ['Tax'], '')).toEqual<SuggestionItem[]>([])
    })

    it('respects the limit', () => {
        const out = filterSuggestions(
            Array.from({ length: 20 }, (_, i) => `F${i}`),
            Array.from({ length: 20 }, (_, i) => `N${i}`),
            'N',
            5
        )
        expect(out.length).toBe(5)
    })
})

describe('applyNameInsertion', () => {
    it('replaces the in-progress identifier without trailing paren', () => {
        const draft = '=Ta'
        const token = parseFunctionToken(draft, 3)
        if (token == null) throw new Error('token not found')
        const result = applyNameInsertion(draft, token, 'TaxRate')
        expect(result.draft).toBe('=TaxRate')
        expect(result.selection.start).toBe(8)
        expect(result.selection.end).toBe(8)
    })
})
