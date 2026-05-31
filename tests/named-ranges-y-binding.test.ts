import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
    findExistingKey,
    listNamedRanges,
    normalizeName,
    readNamedRange,
    removeNamedRangeByKey,
    renameNamedRange,
    validateName,
    writeNamedRange,
} from '../tinycld/calc/lib/named-ranges/y-binding'
import { NAMED_RANGES_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

describe('validateName', () => {
    it.each([
        ['TaxRate', true],
        ['_taxes', true],
        ['Q.Total', true],
        ['Greek_α', true],
        // Four-letter "column" → outside Excel's column space (max XFD),
        // so this is NOT an A1 lookalike.
        ['Year2023', true],
    ])('accepts %s', (input, expected) => {
        const result = validateName(input)
        expect(result.ok).toBe(expected)
    })

    it.each([
        ['Q4'],
        ['Tax2024'],
        ['R4C5'],
        ['RC'],
        ['A1'],
    ])('rejects A1/R1C1 lookalike %s', input => {
        const result = validateName(input)
        expect(result.ok).toBe(false)
    })

    it.each([['1foo'], ['.NET'], [' '], ['']])('rejects bad leading char %s', input => {
        expect(validateName(input).ok).toBe(false)
    })

    it('rejects names with illegal characters', () => {
        expect(validateName('foo bar').ok).toBe(false)
        expect(validateName('foo-bar').ok).toBe(false)
        expect(validateName('foo+bar').ok).toBe(false)
    })
})

describe('normalizeName', () => {
    it('lowercases + trims', () => {
        expect(normalizeName('  TaxRate  ')).toBe('taxrate')
    })
})

describe('writeNamedRange / readNamedRange', () => {
    it('round-trips a workbook-global range', () => {
        const doc = new Y.Doc()
        doc.transact(() => {
            writeNamedRange(doc, {
                name: 'TaxRate',
                expression: '=0.085',
                scope: null,
            })
        }, LOCAL_ORIGIN)
        const entry = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP).get('taxrate')
        const range = readNamedRange(entry)
        expect(range).toEqual({
            name: 'TaxRate',
            expression: '=0.085',
            scope: null,
            comment: undefined,
        })
    })

    it('round-trips a sheet-scoped range with comment', () => {
        const doc = new Y.Doc()
        doc.transact(() => {
            writeNamedRange(doc, {
                name: 'Revenue',
                expression: '=Sheet1!$A$1:$A$10',
                scope: 'sheet1',
                comment: 'Top-line revenue',
            })
        }, LOCAL_ORIGIN)
        const entry = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP).get('revenue')
        const range = readNamedRange(entry)
        expect(range?.scope).toBe('sheet1')
        expect(range?.comment).toBe('Top-line revenue')
    })

    it('writeNamedRange throws on invalid name', () => {
        const doc = new Y.Doc()
        expect(() =>
            doc.transact(() => {
                writeNamedRange(doc, { name: 'Q4', expression: '=1', scope: null })
            }, LOCAL_ORIGIN)
        ).toThrow(/Invalid named range/)
    })
})

describe('listNamedRanges', () => {
    it('returns entries sorted by key', () => {
        const doc = new Y.Doc()
        doc.transact(() => {
            writeNamedRange(doc, { name: 'Beta', expression: '=2', scope: null })
            writeNamedRange(doc, { name: 'Alpha', expression: '=1', scope: null })
        }, LOCAL_ORIGIN)
        const out = listNamedRanges(doc)
        expect(out.map(e => e.range.name)).toEqual(['Alpha', 'Beta'])
    })
})

describe('removeNamedRangeByKey', () => {
    it('removes the entry', () => {
        const doc = new Y.Doc()
        doc.transact(() => {
            writeNamedRange(doc, { name: 'TaxRate', expression: '=0.085', scope: null })
        }, LOCAL_ORIGIN)
        expect(findExistingKey(doc, 'taxrate')).toBe('taxrate')
        doc.transact(() => removeNamedRangeByKey(doc, 'taxrate'), LOCAL_ORIGIN)
        expect(findExistingKey(doc, 'taxrate')).toBeNull()
    })
})

describe('renameNamedRange', () => {
    it('updates the display name in-place when lowercase is unchanged', () => {
        const doc = new Y.Doc()
        doc.transact(() => {
            writeNamedRange(doc, { name: 'taxrate', expression: '=0.085', scope: null })
        }, LOCAL_ORIGIN)
        doc.transact(() => {
            renameNamedRange(doc, 'taxrate', 'TaxRate')
        }, LOCAL_ORIGIN)
        const entry = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP).get('taxrate')
        expect(readNamedRange(entry)?.name).toBe('TaxRate')
    })

    it('returns null when the target key already exists', () => {
        const doc = new Y.Doc()
        doc.transact(() => {
            writeNamedRange(doc, { name: 'Alpha', expression: '=1', scope: null })
            writeNamedRange(doc, { name: 'Beta', expression: '=2', scope: null })
        }, LOCAL_ORIGIN)
        let result: string | null = null
        doc.transact(() => {
            result = renameNamedRange(doc, 'alpha', 'Beta')
        }, LOCAL_ORIGIN)
        expect(result).toBeNull()
    })
})
