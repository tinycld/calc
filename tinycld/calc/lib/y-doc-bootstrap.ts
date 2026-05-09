import * as Y from 'yjs'
import type { CellStyle, WorkbookModel } from './workbook-types'
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
}

export interface YCellValue {
    raw: string
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
            sheetsMap.set(sheetId, meta)

            for (const [localKey, value] of Object.entries(sheet.cells)) {
                const parts = localKey.split(':')
                if (parts.length !== 2) continue
                const row = Number(parts[0])
                const col = Number(parts[1])
                if (!Number.isFinite(row) || !Number.isFinite(col)) continue

                const cell = new Y.Map<unknown>()
                // Plain-string raw/display, continuing the no-coercion
                // rule from the prior session. Numbers / dates parsed
                // from the .xlsx are stringified as the parser already
                // computed them.
                cell.set('raw', String(value.raw ?? ''))
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

// readStyleFromYMap is the inverse of buildStyleYMap — walks the
// nested style Y.Map tree and produces a partial CellStyle. Returns
// undefined if the cell has no style entry or the entry is empty.
export function readStyleFromYMap(cell: Y.Map<unknown>): CellStyle | undefined {
    const entry = cell.get(STYLE_KEY)
    if (entry == null) return undefined
    if (!(entry instanceof Y.Map)) return undefined
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
    return entries.map((e) => e.id)
}

// ydocIsEmpty returns true if the doc has no sheets yet — i.e. it has
// not been bootstrapped. The bootstrap path is gated on this exact
// check.
export function ydocIsEmpty(doc: Y.Doc): boolean {
    return doc.getMap<Y.Map<unknown>>(SHEETS_MAP).size === 0
}
