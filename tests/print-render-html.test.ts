import { describe, expect, it } from 'vitest'
import type { PrintSnapshot } from '../tinycld/calc/lib/print/snapshot'
import { renderPrintHtml } from '../tinycld/calc/lib/print/render-print-html'
import { DEFAULT_PRINT_CONFIG } from '../tinycld/calc/lib/print/types'

function snap(overrides: Partial<PrintSnapshot['sheets'][number]> = {}): PrintSnapshot {
    return {
        sheets: [
            {
                id: 'sheet1',
                name: 'Sheet1',
                rowOffset: 1,
                colOffset: 1,
                rowCount: 2,
                colCount: 2,
                cells: new Map([
                    ['1:1', { display: 'A1' }],
                    ['1:2', { display: 'B1' }],
                    ['2:1', { display: 'A2' }],
                    ['2:2', { display: 'B2' }],
                ]),
                colWidths: undefined,
                rowHeights: undefined,
                ...overrides,
            },
        ],
    }
}

describe('renderPrintHtml', () => {
    it('produces a full HTML document with doctype', () => {
        const html = renderPrintHtml(snap(), DEFAULT_PRINT_CONFIG)
        expect(html.startsWith('<!doctype html>')).toBe(true)
        expect(html).toContain('<html')
        expect(html).toContain('<head>')
        expect(html).toContain('<body>')
        expect(html).toContain('</html>')
    })

    it('includes the page CSS inside a <style> block in <head>', () => {
        const html = renderPrintHtml(snap(), DEFAULT_PRINT_CONFIG)
        expect(html).toMatch(/<head>[\s\S]*<style>[\s\S]*@page[\s\S]*<\/style>[\s\S]*<\/head>/)
    })

    it('renders each cell display in a <td>', () => {
        const html = renderPrintHtml(snap(), DEFAULT_PRINT_CONFIG)
        expect(html).toContain('<td>A1</td>')
        expect(html).toContain('<td>B1</td>')
        expect(html).toContain('<td>A2</td>')
        expect(html).toContain('<td>B2</td>')
    })

    it('escapes HTML in cell display text', () => {
        const html = renderPrintHtml(
            snap({
                cells: new Map([
                    ['1:1', { display: '<script>alert(1)</script>' }],
                    ['1:2', { display: 'A & B' }],
                ]),
            }),
            DEFAULT_PRINT_CONFIG
        )
        expect(html).not.toContain('<script>')
        expect(html).toContain('&lt;script&gt;')
        expect(html).toContain('A &amp; B')
    })

    it('renders the row-header strip when showHeaders is true', () => {
        const html = renderPrintHtml(snap(), {
            ...DEFAULT_PRINT_CONFIG,
            layout: { ...DEFAULT_PRINT_CONFIG.layout, showHeaders: true },
        })
        expect(html).toMatch(/<th class="row-header">1<\/th>/)
        expect(html).toMatch(/<th class="col-header">A<\/th>/)
        expect(html).toMatch(/<th class="col-header">B<\/th>/)
    })

    it('omits the row-header strip when showHeaders is false', () => {
        const html = renderPrintHtml(snap(), DEFAULT_PRINT_CONFIG)
        // No <th class="row-header"> or <th class="col-header"> elements should
        // appear when headers are off. The shared CSS rules for those classes
        // may still appear in the <style> block — they harm nothing because
        // no element uses them.
        expect(html).not.toMatch(/<th class="row-header"/)
        expect(html).not.toMatch(/<th class="col-header"/)
    })

    it('uses correct column labels with offset', () => {
        const html = renderPrintHtml(
            snap({
                rowOffset: 5,
                colOffset: 3,
                rowCount: 1,
                colCount: 1,
                cells: new Map([['5:3', { display: 'x' }]]),
            }),
            { ...DEFAULT_PRINT_CONFIG, layout: { ...DEFAULT_PRINT_CONFIG.layout, showHeaders: true } }
        )
        expect(html).toContain('>C<')
        expect(html).toContain('>5<')
    })

    it('renders a <thead> with the repeat-rows when repeatRows is set', () => {
        const html = renderPrintHtml(
            {
                sheets: [
                    {
                        id: 'sheet1',
                        name: 'S',
                        rowOffset: 1,
                        colOffset: 1,
                        rowCount: 5,
                        colCount: 2,
                        cells: new Map([
                            ['1:1', { display: 'Hdr1' }],
                            ['1:2', { display: 'Hdr2' }],
                            ['3:1', { display: 'data' }],
                        ]),
                        colWidths: undefined,
                        rowHeights: undefined,
                    },
                ],
            },
            {
                ...DEFAULT_PRINT_CONFIG,
                layout: {
                    ...DEFAULT_PRINT_CONFIG.layout,
                    repeatRows: { from: 1, to: 1 },
                },
            }
        )
        expect(html).toMatch(/<thead>[\s\S]*Hdr1[\s\S]*<\/thead>/)
    })

    it('omits <thead> when repeatRows is null', () => {
        const html = renderPrintHtml(snap(), DEFAULT_PRINT_CONFIG)
        expect(html).not.toContain('<thead>')
    })

    it('renders the sheet title only when there is more than one sheet', () => {
        const oneSheet = renderPrintHtml(snap(), DEFAULT_PRINT_CONFIG)
        // No <h2 class="sheet-title"> when only one sheet is rendered.
        // The shared CSS rule for that class may still be in the <style>
        // block — that's harmless.
        expect(oneSheet).not.toMatch(/<h2 class="sheet-title"/)

        const twoSheets = renderPrintHtml(
            {
                sheets: [
                    ...snap().sheets,
                    {
                        id: 'sheet2',
                        name: 'Other',
                        rowOffset: 1,
                        colOffset: 1,
                        rowCount: 1,
                        colCount: 1,
                        cells: new Map([['1:1', { display: 'x' }]]),
                        colWidths: undefined,
                        rowHeights: undefined,
                    },
                ],
            },
            DEFAULT_PRINT_CONFIG
        )
        expect(twoSheets).toMatch(/<h2 class="sheet-title"/)
        expect(twoSheets).toContain('Sheet1')
        expect(twoSheets).toContain('Other')
    })

    it('inlines per-cell style', () => {
        const html = renderPrintHtml(
            snap({
                cells: new Map([
                    ['1:1', { display: 'X', style: { font: { bold: true } } }],
                ]),
                rowCount: 1,
                colCount: 1,
            }),
            DEFAULT_PRINT_CONFIG
        )
        expect(html).toMatch(/<td style="[^"]*font-weight:bold[^"]*">X<\/td>/)
    })

    it('HTML-escapes quotes inside the inline style attribute', () => {
        // cellStyleToInlineCss emits font-family with double-quoted CSS
        // strings. When that CSS lives inside an HTML style="..." attribute,
        // the inner double quotes MUST be entity-escaped or they terminate
        // the attribute. Round-trip: font name "Arial" → CSS
        // font-family:"Arial" → HTML font-family:&quot;Arial&quot;
        const html = renderPrintHtml(
            snap({
                cells: new Map([
                    [
                        '1:1',
                        {
                            display: 'x',
                            style: { font: { name: 'Arial' } },
                        },
                    ],
                ]),
                rowCount: 1,
                colCount: 1,
            }),
            DEFAULT_PRINT_CONFIG
        )
        expect(html).toContain('font-family:&quot;Arial&quot;')
        expect(html).not.toMatch(/style="font-family:"Arial"/)
    })

    it('uses sparse colWidths to size <colgroup>', () => {
        const html = renderPrintHtml(
            snap({
                colWidths: { 1: 200 },
                rowCount: 1,
                colCount: 2,
                cells: new Map([['1:1', { display: 'x' }]]),
            }),
            DEFAULT_PRINT_CONFIG
        )
        expect(html).toMatch(/<col style="width:200px"/)
        expect(html).toMatch(/<col style="width:96px"/)
    })

    it('renders an empty <tbody> when sheet has zero rows', () => {
        const html = renderPrintHtml(
            {
                sheets: [
                    {
                        id: 'sheet1',
                        name: 'Empty',
                        rowOffset: 1,
                        colOffset: 1,
                        rowCount: 0,
                        colCount: 0,
                        cells: new Map(),
                        colWidths: undefined,
                        rowHeights: undefined,
                    },
                ],
            },
            DEFAULT_PRINT_CONFIG
        )
        expect(html).toMatch(/<tbody>\s*<\/tbody>/)
    })

    it('wraps repeat rows in <thead> even when column headers are also on', () => {
        // When showHeaders is true AND repeatRows is set, there should be
        // TWO <thead> elements in the table — one for column headers, one
        // for the repeat rows. Repeat rows MUST NOT emit as bare <tr>
        // between </thead> and <tbody>.
        const html = renderPrintHtml(
            {
                sheets: [
                    {
                        id: 'sheet1',
                        name: 'S',
                        rowOffset: 1,
                        colOffset: 1,
                        rowCount: 3,
                        colCount: 1,
                        cells: new Map([
                            ['1:1', { display: 'Hdr' }],
                            ['2:1', { display: 'a' }],
                            ['3:1', { display: 'b' }],
                        ]),
                        colWidths: undefined,
                        rowHeights: undefined,
                    },
                ],
            },
            {
                ...DEFAULT_PRINT_CONFIG,
                layout: {
                    ...DEFAULT_PRINT_CONFIG.layout,
                    showHeaders: true,
                    repeatRows: { from: 1, to: 1 },
                },
            }
        )
        // Two distinct <thead> opens.
        const opens = (html.match(/<thead>/g) ?? []).length
        expect(opens).toBe(2)
        // The repeat row's content must be inside one of the theads, not
        // between </thead> and <tbody>.
        expect(html).not.toMatch(/<\/thead>\s*<tr[^>]*>\s*<th class="row-header">1<\/th>/)
    })

    it('clamps repeat-row range to the sheet slice', () => {
        // repeatRows.from extends below the slice's rowOffset; only
        // in-slice rows should appear in the <thead>.
        const html = renderPrintHtml(
            {
                sheets: [
                    {
                        id: 'sheet1',
                        name: 'S',
                        rowOffset: 5,
                        colOffset: 1,
                        rowCount: 2,
                        colCount: 1,
                        cells: new Map([
                            ['5:1', { display: 'r5' }],
                            ['6:1', { display: 'r6' }],
                        ]),
                        colWidths: undefined,
                        rowHeights: undefined,
                    },
                ],
            },
            {
                ...DEFAULT_PRINT_CONFIG,
                layout: {
                    ...DEFAULT_PRINT_CONFIG.layout,
                    repeatRows: { from: 1, to: 5 },
                },
            }
        )
        // Only r5 (in-slice intersect with [1..5]) should appear.
        expect(html).toMatch(/<thead>[\s\S]*r5[\s\S]*<\/thead>/)
        expect(html).not.toMatch(/<thead>[\s\S]*r6[\s\S]*<\/thead>/)
    })

    it('orders repeat rows before the rest of the body', () => {
        const html = renderPrintHtml(
            {
                sheets: [
                    {
                        id: 'sheet1',
                        name: 'S',
                        rowOffset: 1,
                        colOffset: 1,
                        rowCount: 4,
                        colCount: 1,
                        cells: new Map([
                            ['1:1', { display: 'H' }],
                            ['2:1', { display: 'a' }],
                            ['3:1', { display: 'b' }],
                            ['4:1', { display: 'c' }],
                        ]),
                        colWidths: undefined,
                        rowHeights: undefined,
                    },
                ],
            },
            {
                ...DEFAULT_PRINT_CONFIG,
                layout: {
                    ...DEFAULT_PRINT_CONFIG.layout,
                    repeatRows: { from: 1, to: 1 },
                },
            }
        )
        const thead = html.indexOf('<thead>')
        const tbody = html.indexOf('<tbody>')
        const hIdx = html.indexOf('>H<')
        const aIdx = html.indexOf('>a<')
        expect(thead).toBeGreaterThan(-1)
        expect(tbody).toBeGreaterThan(thead)
        expect(hIdx).toBeGreaterThan(thead)
        expect(hIdx).toBeLessThan(tbody)
        expect(aIdx).toBeGreaterThan(tbody)
    })
})
