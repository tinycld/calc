import type { PrintConfig, PrintMargins } from './types'

// Numbers are inches because @page margins are universally supported
// in inches and that matches the labels print preview shows.
const MARGIN_INCHES: Record<PrintMargins, string> = {
    narrow: '0.25in',
    normal: '0.75in',
    wide: '1in',
}

// buildPageCss returns the BODY of a <style> block (no outer <style>
// tags). The renderer prepends this inside the print HTML's <head>.
export function buildPageCss(config: PrintConfig): string {
    const { orientation, scaling, margins } = config.page
    const { showGridlines } = config.layout

    const lines: string[] = []

    lines.push(
        `@page { size: ${orientation}; margin: ${MARGIN_INCHES[margins]}; }`,
    )

    lines.push('html, body { margin: 0; padding: 0; }')
    lines.push(
        "body { font-family: -apple-system, system-ui, 'Segoe UI', sans-serif; color: #000; }",
    )

    const tableWidth =
        scaling === 'fit-width' || scaling === 'fit-page' ? '100%' : 'auto'
    lines.push(
        `table.grid { border-collapse: collapse; width: ${tableWidth}; table-layout: fixed; }`,
    )

    if (scaling === 'fit-page') {
        // Best-effort: hint the print engine to keep the table on a
        // single page. Browsers vary in honoring this; the OS print
        // dialog's own "fit to page" usually overrides.
        lines.push('table.grid { page-break-inside: avoid; }')
    }

    lines.push('thead { display: table-header-group; }')
    lines.push('tr { break-inside: avoid; page-break-inside: avoid; }')

    if (showGridlines) {
        lines.push(
            'table.grid td, table.grid th { border: 1px solid #ccc; padding: 2px 4px; }',
        )
    } else {
        lines.push('table.grid td, table.grid th { padding: 2px 4px; }')
    }

    lines.push(
        '.row-header, .col-header { background-color: #f2f2f2; text-align: center; font-weight: normal; color: #555; font-size: 9pt; }',
    )

    lines.push(
        '.sheet-title { font-size: 14pt; margin: 0 0 8px 0; padding-top: 12px; break-before: page; }',
    )
    lines.push(
        '.print-sheet:first-of-type .sheet-title { break-before: avoid; padding-top: 0; }',
    )

    return lines.join('\n')
}
