import * as Y from 'yjs'
import { MERGES_KEY } from './merge'
import type { CellKind, CellRaw, CellStyle, WorkbookModel } from './workbook-types'
import { yCellKey } from './y-cell-key'

// SHEETS_MAP is the Y.Map name holding sheet metadata, keyed by sheet id.
export const SHEETS_MAP = 'sheets'
// CELLS_MAP is the Y.Map name holding cell values across all sheets,
// keyed by yCellKey(sheetId, row, col).
//
// Tombstone caveat: every Y.Map.set on the same key retains a CRDT
// tombstone for the prior value. For a single editing session this is
// bounded (~ "edits made this session") and fine. If we later persist
// the Y.Doc across sessions or expect long-lived editing without
// compaction, switch to `YKeyValue` from y-utility — it wraps a
// Y.Array and avoids the tombstone growth.
//   ref: https://docs.yjs.dev/api/shared-types/y.map (gotcha)
//   ref: https://github.com/yjs/y-utility
//
// Scale caveat: each cell is itself a Y.Map (raw/display/formula).
// 10k+ nested Y.Maps in one doc has been reported to slow browsers
// significantly (https://discuss.yjs.dev/t/common-concepts-best-practices/2436).
// A 100x100 sheet is 10k cells. If we hit perf walls on large sheets,
// options are:
//   - flatten cells to JSON strings keyed in one Y.Map (lose
//     per-field reactivity, gain ~Nx fewer nested types)
//   - subdocs per sheet so the live doc only holds the active sheet
//   - YKeyValue per cell to drop tombstones AND nested Y.Map overhead
export const CELLS_MAP = 'cells'

// STYLE_KEY is the cell-Y.Map key under which an optional Y.Map of
// formatting attributes lives (font, fill, alignment, numFmt). Present
// only when the cell has at least one tracked style attribute. Absence
// is significant — see CellStyle in workbook-types.ts.
export const STYLE_KEY = 'style'

export interface YSheetMeta {
    name: string
    position: number
    rowCount: number
    colCount: number
    // Sparse per-column width overrides. Absent = render at
    // DEFAULT_COL_WIDTH. Read via `readColWidth` in lib/dimensions.ts —
    // call sites should not index this directly so the default-fallback
    // stays in one place.
    colWidths?: Record<number, number>
    // Sparse per-row height overrides. Absent = render at
    // DEFAULT_ROW_HEIGHT. Read via `readRowHeight` in lib/dimensions.ts.
    rowHeights?: Record<number, number>
    // Sparse per-row style overrides. Absent = no row-level style,
    // cells render with their own + col/sheet layers only. Read via
    // `readRowStylesFromMeta` in lib/sheet-styles.ts.
    rowStyles?: Record<number, import('./workbook-types').CellStyle>
    // Persistent filter view metadata when the user has set up a
    // filter on this sheet. The Y.Map under the `filterView` key holds
    // { range, criteria, savedHeights } — read/written via the helpers
    // in lib/filter.ts. Bootstrap doesn't touch this field; it
    // round-trips because we never strip unknown keys.
    filterView?: unknown
    // Optional tab color. User-chosen literal hex string (e.g. "#FF0000").
    // Absent = render with the default tab color. Round-trips through
    // excelize's TabColorRGB on the server side.
    color?: string
    // Optional hidden flag. Absent = visible. Hidden sheets are filtered
    // out of the public sheet list (see useYSheets) but still appear in
    // the "Show hidden" submenu in the sheet-tabs UI.
    hidden?: boolean
}

export const SHEET_COLOR_KEY = 'color'
export const SHEET_HIDDEN_KEY = 'hidden'

// YCellValue is the typed snapshot returned by useYCell. `kind` carries
// the cell's semantic type; `raw` is the value in a Yjs-serializable
// form (no JS Date — dates are ISO strings). Legacy cells written
// before the typed-cell schema landed have no `kind` key on disk; the
// reader synthesizes `kind: 'string'` and string-coerces `raw` to
// match what was rendered before.
export interface YCellValue {
    kind: CellKind
    raw: CellRaw
    display: string
    formula?: string
    style?: CellStyle
}

// bootstrapYDocFromWorkbook seeds an empty Y.Doc from a parsed
// WorkbookModel. Call this exactly once when a tab is the first joiner
// of an empty room (i.e. the broker's SYNC_REPLY came back empty).
// Subsequent joiners receive doc state from existing peers and must NOT
// re-bootstrap.
//
// Sheet IDs: the parser produces an array of unnamed sheets; we assign
// stable ids of the form `sheet${i}` so the Y.Map and Grid keying are
// stable across reconnects.
export function bootstrapYDocFromWorkbook(doc: Y.Doc, model: WorkbookModel): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

    doc.transact(() => {
        for (let i = 0; i < model.sheets.length; i++) {
            const sheet = model.sheets[i]
            const sheetId = `sheet${i + 1}`

            const meta = new Y.Map<unknown>()
            meta.set('name', sheet.name)
            meta.set('position', i)
            meta.set('rowCount', sheet.rowCount)
            meta.set('colCount', sheet.colCount)
            if (sheet.color != null && sheet.color !== '') {
                meta.set(SHEET_COLOR_KEY, sheet.color)
            }
            if (sheet.hidden === true) {
                meta.set(SHEET_HIDDEN_KEY, true)
            }
            sheetsMap.set(sheetId, meta)

            if (sheet.merges != null && sheet.merges.length > 0) {
                const mergesMap = new Y.Map<{ rowSpan: number; colSpan: number }>()
                for (const m of sheet.merges) {
                    if (m.rowSpan < 1 || m.colSpan < 1) continue
                    if (m.rowSpan === 1 && m.colSpan === 1) continue
                    mergesMap.set(`${m.anchorRow}:${m.anchorCol}`, {
                        rowSpan: m.rowSpan,
                        colSpan: m.colSpan,
                    })
                }
                if (mergesMap.size > 0) {
                    meta.set(MERGES_KEY, mergesMap)
                }
            }

            for (const [localKey, value] of Object.entries(sheet.cells)) {
                const parts = localKey.split(':')
                if (parts.length !== 2) continue
                const row = Number(parts[0])
                const col = Number(parts[1])
                if (!Number.isFinite(row) || !Number.isFinite(col)) continue

                const cell = new Y.Map<unknown>()
                // `kind` is authoritative for what the cell IS; `raw`
                // carries the value in a Yjs-serializable form (Dates
                // are normalized to ISO strings upstream by the
                // adapter). `display` is the cache of formatCell(kind,
                // raw) so old peers (and serializers without the
                // formatter) can render correctly without recomputing.
                cell.set('kind', value.kind)
                cell.set('raw', toYRaw(value.raw))
                cell.set('display', value.display)
                if (value.formula) {
                    cell.set('formula', value.formula)
                }
                if (value.style != null) {
                    const styleMap = buildStyleYMap(value.style)
                    if (styleMap != null) {
                        cell.set(STYLE_KEY, styleMap)
                    }
                }
                cellsMap.set(yCellKey(sheetId, row, col), cell)
            }
        }
    })
}

// toYRaw normalizes a CellValue.raw (which may carry a JS Date from
// the upstream parser) into a Yjs-serializable scalar. Dates are
// converted to ISO strings; everything else passes through.
function toYRaw(raw: CellStyle | CellRaw | Date | undefined): CellRaw {
    if (raw == null) return null
    if (raw instanceof Date) {
        if (
            raw.getUTCHours() === 0 &&
            raw.getUTCMinutes() === 0 &&
            raw.getUTCSeconds() === 0 &&
            raw.getUTCMilliseconds() === 0
        ) {
            return raw.toISOString().slice(0, 10)
        }
        return raw.toISOString()
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw
    return null
}

// readYCell is the canonical reader for one cell's value out of the
// Y.Doc. Legacy cells (written before the typed-cell schema) have no
// `kind` key; the reader synthesizes `kind: 'string'` and coerces
// `raw` to a string so display continues to render the way it did.
//
// Used by useYCell (and any other consumer that needs a typed snapshot
// out of the doc — a single source of read-side truth keeps live
// renders and the snapshot pipeline in sync).
export function readYCell(cell: Y.Map<unknown>): YCellValue {
    const rawRaw = cell.get('raw')
    const kindRaw = cell.get('kind')
    const display = cell.get('display')
    const formula = cell.get('formula')
    const style = readStyleFromYMap(cell)

    const kind: CellKind =
        kindRaw === 'number' || kindRaw === 'boolean' || kindRaw === 'date' || kindRaw === 'formula'
            ? kindRaw
            : 'string'
    let raw: CellRaw
    switch (kind) {
        case 'number':
            raw = typeof rawRaw === 'number' ? rawRaw : Number(rawRaw)
            if (typeof raw === 'number' && !Number.isFinite(raw)) raw = null
            break
        case 'boolean':
            raw = typeof rawRaw === 'boolean' ? rawRaw : null
            break
        case 'date':
            raw = typeof rawRaw === 'string' ? rawRaw : null
            break
        case 'formula':
            // Cached scalar may be string/number/boolean/null. Trust
            // whatever was written; null means "no cached value yet".
            raw =
                typeof rawRaw === 'string' ||
                typeof rawRaw === 'number' ||
                typeof rawRaw === 'boolean'
                    ? rawRaw
                    : null
            break
        case 'string':
            // Legacy cells written before kind existed wrote `raw` as a
            // string; new string cells likewise carry strings. Coerce
            // anything else (defensively) to its string form.
            raw = typeof rawRaw === 'string' ? rawRaw : rawRaw == null ? '' : String(rawRaw)
            break
    }

    return {
        kind,
        raw,
        display: typeof display === 'string' ? display : display == null ? '' : String(display),
        formula: typeof formula === 'string' ? formula : undefined,
        style,
    }
}

// buildStyleYMap converts a partial CellStyle into a nested Y.Map tree
// suitable for storing under cell[STYLE_KEY]. Only groups (font, fill,
// alignment) and individual keys that are actually present in the
// patch are written — the "absent = untracked" rule applies at every
// nesting level. Returns null if the patch is structurally empty.
//
// New style groups land here additively: just add another `case` to
// the switch with the same shape.
export function buildStyleYMap(style: CellStyle): Y.Map<unknown> | null {
    const out = new Y.Map<unknown>()
    let any = false
    for (const groupKey of Object.keys(style) as (keyof CellStyle)[]) {
        const groupValue = style[groupKey]
        if (groupValue == null) continue
        if (typeof groupValue === 'string') {
            // Scalar group (e.g. numFmt). Mirror as a plain string.
            out.set(groupKey, groupValue)
            any = true
            continue
        }
        const groupMap = new Y.Map<unknown>()
        let groupAny = false
        for (const [k, v] of Object.entries(groupValue)) {
            if (v == null) continue
            groupMap.set(k, v as unknown)
            groupAny = true
        }
        if (groupAny) {
            out.set(groupKey, groupMap)
            any = true
        }
    }
    return any ? out : null
}

// readStyleFromYMapEntry walks a nested style Y.Map tree (the same
// shape buildStyleYMap produces) and returns a partial CellStyle.
// Returns undefined if the entry is empty. Works for any caller that
// already holds the style YMap directly — used by sheet-level row /
// column / sheet-default style readers, which store the style YMap on
// sheet metadata rather than inside a cell.
export function readStyleFromYMapEntry(entry: Y.Map<unknown>): CellStyle | undefined {
    const out: Record<string, unknown> = {}
    let any = false
    entry.forEach((v, k) => {
        if (v == null) return
        if (v instanceof Y.Map) {
            const group: Record<string, unknown> = {}
            let groupAny = false
            v.forEach((vv, kk) => {
                if (vv != null) {
                    group[kk] = vv
                    groupAny = true
                }
            })
            if (groupAny) {
                out[k] = group
                any = true
            }
        } else {
            out[k] = v
            any = true
        }
    })
    return any ? (out as CellStyle) : undefined
}

// readStyleFromYMap is the inverse of buildStyleYMap — walks the
// nested style Y.Map tree and produces a partial CellStyle. Returns
// undefined if the cell has no style entry or the entry is empty.
export function readStyleFromYMap(cell: Y.Map<unknown>): CellStyle | undefined {
    const entry = cell.get(STYLE_KEY)
    if (!(entry instanceof Y.Map)) return undefined
    return readStyleFromYMapEntry(entry)
}

// cloneYMapDeep returns a fresh, unintegrated Y.Map that mirrors
// source's contents. Nested Y.Maps are recursively cloned. Scalars
// (number/string/boolean/null) are copied by value. Anything else
// (Y.Array, Y.Text — not currently used in cell or style maps) is
// copied by reference of the scalar form, which is unreachable for
// today's schema.
//
// Used by row/column structural mutations (insert/delete shift cells)
// and by sheet duplication (clone every cell into the new sheet).
// Lives here rather than in structural-mutations.ts so use-sheet-actions
// can share it without dragging in the structural-mutations namespace.
export function cloneYMapDeep(source: Y.Map<unknown>): Y.Map<unknown> {
    const out = new Y.Map<unknown>()
    source.forEach((value, key) => {
        if (value instanceof Y.Map) {
            out.set(key, cloneYMapDeep(value as Y.Map<unknown>))
        } else {
            out.set(key, value)
        }
    })
    return out
}

// ydocSheetIds returns the array of sheet ids in the doc's `sheets`
// Y.Map, sorted by their `position` field. Used by `useYSheets` and the
// bootstrap-needed check.
export function ydocSheetIds(doc: Y.Doc): string[] {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const entries: Array<{ id: string; position: number }> = []
    sheetsMap.forEach((meta, id) => {
        const position = (meta.get('position') as number) ?? 0
        entries.push({ id, position })
    })
    entries.sort((a, b) => a.position - b.position)
    return entries.map(e => e.id)
}

// ydocIsEmpty returns true if the doc has no sheets yet — i.e. it has
// not been bootstrapped. The bootstrap path is gated on this exact
// check.
export function ydocIsEmpty(doc: Y.Doc): boolean {
    return doc.getMap<Y.Map<unknown>>(SHEETS_MAP).size === 0
}
