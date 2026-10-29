import * as Y from 'yjs'

// WORKBOOK_MAP holds workbook-wide facts that belong to no one sheet.
// DEFAULT_FONT_KEY under it is a Y.Map { name, size } — the xlsx
// "Normal" style font, in points — that every cell without its own
// font name or size draws in.
export const WORKBOOK_MAP = 'workbook'
export const DEFAULT_FONT_KEY = 'defaultFont'

export interface WorkbookFont {
    name?: string
    size?: number
}

export function readWorkbookDefaultFont(doc: Y.Doc): WorkbookFont {
    const entry = doc.getMap<unknown>(WORKBOOK_MAP).get(DEFAULT_FONT_KEY)
    if (!(entry instanceof Y.Map)) return {}
    const name = entry.get('name')
    // The Go bootstrap stores a fractional size (10.5) in the one-item
    // array form it uses for fractional numbers (y-crdt drops a bare
    // float), so unwrap that form.
    const rawSize = entry.get('size')
    const size = Array.isArray(rawSize) && rawSize.length === 1 ? rawSize[0] : rawSize
    return {
        name: typeof name === 'string' && name !== '' ? name : undefined,
        size: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : undefined,
    }
}
