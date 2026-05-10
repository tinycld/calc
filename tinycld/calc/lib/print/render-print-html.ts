import {
    DEFAULT_COL_WIDTH,
    DEFAULT_ROW_HEIGHT,
    readColWidth,
    readRowHeight,
} from '../dimensions'
import { columnLabel } from '../workbook-types'
import { cellStyleToInlineCss } from './cell-html'
import { buildPageCss } from './page-css'
import type { PrintSheet, PrintSnapshot } from './snapshot'
import type { PrintConfig } from './types'

// renderPrintHtml emits a self-contained HTML document the browser
// can print directly. One <section> per sheet, each with a single
// <table class="grid"> styled by buildPageCss.
//
// Pure function: given (snapshot, config) the output is deterministic
// — unit tests snapshot the string. No DOM, no React, no Yjs.
//
// Asset constraint: the output must reference no external assets
// (no <link>, no <img>, no @font-face, no url()). iOS expo-print
// doesn't bundle them.
export function renderPrintHtml(snapshot: PrintSnapshot, config: PrintConfig): string {
    const multiSheet = snapshot.sheets.length > 1
    const lines: string[] = []
    lines.push('<!doctype html>')
    lines.push('<html lang="en">')
    lines.push('<head>')
    lines.push('<meta charset="utf-8">')
    lines.push('<title>Print</title>')
    lines.push('<style>')
    lines.push(buildPageCss(config))
    lines.push('</style>')
    lines.push('</head>')
    lines.push('<body>')

    for (const sheet of snapshot.sheets) {
        lines.push('<section class="print-sheet">')
        if (multiSheet) {
            lines.push(`<h2 class="sheet-title">${escapeHtml(sheet.name)}</h2>`)
        }
        lines.push(renderSheetTable(sheet, config))
        lines.push('</section>')
    }

    lines.push('</body>')
    lines.push('</html>')
    return lines.join('\n')
}

function renderSheetTable(sheet: PrintSheet, config: PrintConfig): string {
    const { showHeaders, repeatRows } = config.layout
    const parts: string[] = ['<table class="grid">']

    // <colgroup>: optional first <col> for the row-header column, then
    // one <col> per data column at the configured width (sparse override
    // or default).
    parts.push('<colgroup>')
    if (showHeaders) {
        parts.push('<col style="width:48px">')
    }
    for (let c = 0; c < sheet.colCount; c++) {
        const absCol = sheet.colOffset + c
        const width = readColWidth(sheet.colWidths, absCol) || DEFAULT_COL_WIDTH
        parts.push(`<col style="width:${width}px">`)
    }
    parts.push('</colgroup>')

    // Column-header row — rendered as a <thead> so browsers repeat it
    // on every printed page. Only emitted when showHeaders is on.
    if (showHeaders) {
        parts.push('<thead>')
        parts.push('<tr>')
        parts.push('<th class="row-header"></th>')
        for (let c = 0; c < sheet.colCount; c++) {
            const absCol = sheet.colOffset + c
            parts.push(`<th class="col-header">${columnLabel(absCol)}</th>`)
        }
        parts.push('</tr>')
        parts.push('</thead>')
    }

    if (
        repeatRows != null &&
        rangeIntersects(sheet, repeatRows.from, repeatRows.to)
    ) {
        const sliceStart = sheet.rowOffset
        const sliceEnd = sheet.rowOffset + sheet.rowCount - 1
        const clampedFrom = Math.max(repeatRows.from, sliceStart)
        const clampedTo = Math.min(repeatRows.to, sliceEnd)
        // Always wrap repeat rows in their own <thead>. When showHeaders
        // is also on, this is the second <thead> in the table — browsers
        // fold multiple <thead>s into one table-header-group for the
        // print-time repeat behavior.
        parts.push('<thead>')
        for (let r = clampedFrom; r <= clampedTo; r++) {
            parts.push(renderRow(sheet, r, { showHeaders }))
        }
        parts.push('</thead>')
    }

    parts.push('<tbody>')
    const repeatFrom = repeatRows?.from
    const repeatTo = repeatRows?.to
    for (let i = 0; i < sheet.rowCount; i++) {
        const absRow = sheet.rowOffset + i
        // Skip rows that appear in the repeat-rows thead so they are not
        // duplicated in the body.
        if (
            repeatFrom != null &&
            repeatTo != null &&
            absRow >= repeatFrom &&
            absRow <= repeatTo
        ) {
            continue
        }
        parts.push(renderRow(sheet, absRow, { showHeaders }))
    }
    parts.push('</tbody>')

    parts.push('</table>')
    return parts.join('')
}

function rangeIntersects(sheet: PrintSheet, from: number, to: number): boolean {
    const sliceStart = sheet.rowOffset
    const sliceEnd = sheet.rowOffset + sheet.rowCount - 1
    return !(to < sliceStart || from > sliceEnd)
}

interface RowOpts {
    showHeaders: boolean
}

function renderRow(sheet: PrintSheet, absRow: number, opts: RowOpts): string {
    const parts: string[] = []
    const height = readRowHeight(sheet.rowHeights, absRow) || DEFAULT_ROW_HEIGHT
    parts.push(`<tr style="height:${height}px">`)
    if (opts.showHeaders) {
        parts.push(`<th class="row-header">${absRow}</th>`)
    }
    for (let c = 0; c < sheet.colCount; c++) {
        const absCol = sheet.colOffset + c
        const cell = sheet.cells.get(`${absRow}:${absCol}`)
        const display = cell?.display ?? ''
        const inline = cellStyleToInlineCss(cell?.style)
        if (inline === '') {
            parts.push(`<td>${escapeHtml(display)}</td>`)
        } else {
            // The inline-CSS string may contain `"` (font-family is
            // double-quoted in CSS strings). Escape it so the inner
            // `"` cannot terminate the outer style="..." attribute.
            parts.push(
                `<td style="${escapeHtml(inline)}">${escapeHtml(display)}</td>`,
            )
        }
    }
    parts.push('</tr>')
    return parts.join('')
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}
