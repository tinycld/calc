import { describe, expect, it } from 'vitest'
import { cellEditText } from '../tinycld/calc/lib/cell-edit-text'
import { inferCellInput } from '../tinycld/calc/lib/cell-input'

// cellEditText is the text the editor and formula bar start from. It
// must read back through inferCellInput as the same value, so opening
// a cell and pressing Enter never changes it.

describe('cellEditText', () => {
    it('shows a currency number without its format', () => {
        expect(
            cellEditText({ kind: 'number', raw: 639.09, style: { numFmt: '"$"#,##0.00' } })
        ).toBe('639.09')
    })

    it('shows a percent number as a percent', () => {
        expect(cellEditText({ kind: 'number', raw: 0.0146, style: { numFmt: '0.00%' } })).toBe(
            '1.46%'
        )
    })

    it('shows a date with a four-digit year', () => {
        expect(cellEditText({ kind: 'date', raw: '2024-12-06', style: { numFmt: 'm/d/yy' } })).toBe(
            '12/6/2024'
        )
    })

    it('shows a date-time with its time', () => {
        expect(cellEditText({ kind: 'date', raw: '2024-12-06T15:00:00Z' })).toBe(
            '12/6/2024 15:00:00'
        )
    })

    it('shows a number in a date format as a date', () => {
        expect(cellEditText({ kind: 'number', raw: 45632, style: { numFmt: 'M/d/yyyy' } })).toBe(
            '12/6/2024'
        )
    })

    it('shows the formula text of a formula cell', () => {
        expect(cellEditText({ kind: 'formula', raw: 5, formula: '=SUM(A1:A2)' })).toBe(
            '=SUM(A1:A2)'
        )
    })

    it('shows booleans and strings as typed', () => {
        expect(cellEditText({ kind: 'boolean', raw: true })).toBe('TRUE')
        expect(cellEditText({ kind: 'string', raw: 'Seth Johnson' })).toBe('Seth Johnson')
    })

    it.each([
        { kind: 'number' as const, raw: 639.09, style: { numFmt: '"$"#,##0.00' } },
        { kind: 'number' as const, raw: 0.0146, style: { numFmt: '0.00%' } },
        { kind: 'date' as const, raw: '2024-12-06', style: { numFmt: 'm/d/yy' } },
        { kind: 'date' as const, raw: '2024-12-06T15:00:00Z' },
    ])('round-trips $raw through the editor unchanged', cell => {
        expect(inferCellInput(cellEditText(cell)).raw).toBe(cell.raw)
    })
})
