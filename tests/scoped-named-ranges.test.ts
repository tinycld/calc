import { describe, expect, it } from 'vitest'
import {
    deriveScopedNamedRanges,
    type NamedRangeEntry,
} from '../tinycld/calc/hooks/use-named-ranges'
import type { NamedRange } from '../tinycld/calc/lib/named-ranges/types'

function entry(name: string, expression: string, scope: string | null): NamedRangeEntry {
    const range: NamedRange = { name, expression, scope }
    return { key: name.toLowerCase(), range }
}

describe('deriveScopedNamedRanges', () => {
    it('returns globals + sheet-locals only (filters out other-sheet locals)', () => {
        const ranges = [
            entry('Global', '=1', null),
            entry('LocalOnSheet1', '=Sheet1!$A$1', 'sheet1'),
            entry('LocalOnSheet2', '=Sheet2!$A$1', 'sheet2'),
        ]
        const { list } = deriveScopedNamedRanges(ranges, 'sheet1')
        const names = list.map(e => e.range.name)
        expect(names).toContain('Global')
        expect(names).toContain('LocalOnSheet1')
        expect(names).not.toContain('LocalOnSheet2')
        expect(list).toHaveLength(2)
    })

    it('orders sheet-locals before globals', () => {
        const ranges = [
            entry('AlphaGlobal', '=1', null),
            entry('BetaLocal', '=Sheet1!$B$1', 'sheet1'),
            entry('GammaGlobal', '=2', null),
        ]
        const { list } = deriveScopedNamedRanges(ranges, 'sheet1')
        // Sheet-locals come first regardless of input order.
        expect(list[0].range.name).toBe('BetaLocal')
        expect(list.slice(1).map(e => e.range.name)).toEqual(['AlphaGlobal', 'GammaGlobal'])
    })

    it('builds byNormalizedExpression map keyed by uppercase-trimmed expression sans equals', () => {
        const ranges = [
            entry('Revenue', '=Sheet1!$A$1:$A$10', null),
            entry('TaxRate', '=0.085', null),
        ]
        const { byNormalizedExpression } = deriveScopedNamedRanges(ranges, 'sheet1')
        // Match the same selection encoded slightly differently —
        // the normalize step (uppercase + strip `=`) makes both equivalent.
        expect(byNormalizedExpression.get('SHEET1!$A$1:$A$10')?.range.name).toBe('Revenue')
        expect(byNormalizedExpression.get('0.085')?.range.name).toBe('TaxRate')
    })

    it('sheet-local shadows global when expressions collide', () => {
        const ranges = [
            entry('GlobalRev', '=Sheet1!$A$1', null),
            entry('LocalRev', '=Sheet1!$A$1', 'sheet1'),
        ]
        const { byNormalizedExpression } = deriveScopedNamedRanges(ranges, 'sheet1')
        // Local wins because it's placed in the list first.
        expect(byNormalizedExpression.get('SHEET1!$A$1')?.range.name).toBe('LocalRev')
    })

    it('returns empty list + map when no ranges are in scope', () => {
        const ranges = [entry('LocalOnSheet2', '=Sheet2!$A$1', 'sheet2')]
        const { list, byNormalizedExpression } = deriveScopedNamedRanges(ranges, 'sheet1')
        expect(list).toEqual([])
        expect(byNormalizedExpression.size).toBe(0)
    })

    it('skips orphan-scoped ranges (scope id matches no current sheet)', () => {
        // Defensive: a sheet was deleted but a stale entry remains.
        // It shouldn't show up under any sheet's scope.
        const ranges = [entry('Orphan', '=1', 'deleted-sheet-7')]
        const { list } = deriveScopedNamedRanges(ranges, 'sheet1')
        expect(list).toEqual([])
    })
})
