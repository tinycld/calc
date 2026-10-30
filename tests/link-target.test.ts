import { describe, expect, it } from 'vitest'
import { internalLinkTarget } from '../tinycld/calc/lib/link-target'

// A link inside the workbook is stored as "#Sheet2!A1" (the xlsx
// import's form, which HYPERLINK() also takes). Opening it jumps to the
// cell; anything else opens in the browser.
describe('internalLinkTarget', () => {
    it('turns a one-cell sheet link into the range form the jump takes', () => {
        expect(internalLinkTarget('#Sheet2!A1')).toBe('Sheet2!A1:A1')
    })

    it('keeps a range link and a quoted sheet name', () => {
        expect(internalLinkTarget("#'My Sheet'!B2:C4")).toBe("'My Sheet'!B2:C4")
    })

    it('reads a bare cell as the current sheet', () => {
        expect(internalLinkTarget('#B7')).toBe('B7')
    })

    it('is null for a web link', () => {
        expect(internalLinkTarget('https://example.com/#top')).toBeNull()
    })
})
