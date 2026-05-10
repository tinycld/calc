// Filter view: hides rows in a range whose cells don't match a set of
// per-column criteria. Hidden rows use the existing zero-height-hide
// mechanism (Body.tsx skips height<=0 rows). Prior heights are saved
// in the filter view so clearFilter restores them exactly.
//
// The filter definition lives on sheet metadata under the `filterView`
// Y.Map key — persisted alongside the workbook so a reload restores
// the same hidden-row state. Keeping the Y.Map flat (no nested doc
// types) makes the snapshot serializer's job trivial.
import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import type { CellRange } from '../hooks/grid-store'
import { ROW_HEIGHTS_KEY } from './dimensions'
import { yCellKey } from './y-cell-key'
import { CELLS_MAP, SHEETS_MAP } from './y-doc-bootstrap'

export type FilterCondition =
    | { op: 'gt'; value: string }
    | { op: 'lt'; value: string }
    | { op: 'eq'; value: string }
    | { op: 'neq'; value: string }
    | { op: 'contains'; value: string }
    | { op: 'startsWith'; value: string }
    | { op: 'endsWith'; value: string }
    | { op: 'isEmpty' }
    | { op: 'isNotEmpty' }

export type FilterCriterion =
    | { type: 'values'; allowedValues: string[] }
    | { type: 'condition'; condition: FilterCondition }

export interface FilterDefinition {
    range: CellRange
    criteria: Record<number, FilterCriterion>
    savedHeights: Record<number, number>
}

export const FILTER_VIEW_KEY = 'filterView'

// readCellDisplay returns the display string of (row, col), or empty
// string when the cell is missing. Used for both criteria evaluation
// and distinct-values enumeration so the user filters by what they see.
function readCellDisplay(doc: Y.Doc, sheetId: string, row: number, col: number): string {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return ''
    const display = cell.get('display')
    return typeof display === 'string' ? display : ''
}

function readCellNumber(doc: Y.Doc, sheetId: string, row: number, col: number): number | null {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(sheetId, row, col))
    if (cell == null) return null
    const raw = cell.get('raw')
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
        const n = Number(raw)
        return Number.isFinite(n) ? n : null
    }
    return null
}

// matchesCriterion evaluates a single column's criterion against the
// cell at (row, col). Numeric comparators (gt/lt) try to parse the
// criterion's value as a number first; falling back to lexicographic
// for non-numeric column data.
function matchesCriterion(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    col: number,
    criterion: FilterCriterion
): boolean {
    const display = readCellDisplay(doc, sheetId, row, col)
    if (criterion.type === 'values') {
        return criterion.allowedValues.includes(display)
    }
    const cond = criterion.condition
    switch (cond.op) {
        case 'isEmpty':
            return display === ''
        case 'isNotEmpty':
            return display !== ''
        case 'eq':
            return display === cond.value
        case 'neq':
            return display !== cond.value
        case 'contains':
            return display.includes(cond.value)
        case 'startsWith':
            return display.startsWith(cond.value)
        case 'endsWith':
            return display.endsWith(cond.value)
        case 'gt':
        case 'lt': {
            const target = Number(cond.value)
            if (Number.isFinite(target)) {
                const cellNum = readCellNumber(doc, sheetId, row, col)
                if (cellNum == null) return false
                return cond.op === 'gt' ? cellNum > target : cellNum < target
            }
            return cond.op === 'gt' ? display > cond.value : display < cond.value
        }
    }
}

// rowMatches returns true iff EVERY column criterion in `criteria`
// passes for the row. Columns with no criterion are ignored.
function rowMatches(
    doc: Y.Doc,
    sheetId: string,
    row: number,
    criteria: Record<number, FilterCriterion>
): boolean {
    for (const colKey of Object.keys(criteria)) {
        const col = Number(colKey)
        if (!Number.isFinite(col)) continue
        if (!matchesCriterion(doc, sheetId, row, col, criteria[col])) return false
    }
    return true
}

function getMeta(doc: Y.Doc, sheetId: string): Y.Map<unknown> | null {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    return sheetsMap.get(sheetId) ?? null
}

function getOrCreateFilterView(meta: Y.Map<unknown>): Y.Map<unknown> {
    const existing = meta.get(FILTER_VIEW_KEY)
    if (existing instanceof Y.Map) return existing
    const created = new Y.Map<unknown>()
    meta.set(FILTER_VIEW_KEY, created)
    return created
}

function rangeToYMap(range: CellRange): Y.Map<unknown> {
    const m = new Y.Map<unknown>()
    m.set('startRow', range.startRow)
    m.set('endRow', range.endRow)
    m.set('startCol', range.startCol)
    m.set('endCol', range.endCol)
    return m
}

function rangeFromYMap(m: Y.Map<unknown>): CellRange | null {
    const sr = m.get('startRow')
    const er = m.get('endRow')
    const sc = m.get('startCol')
    const ec = m.get('endCol')
    if (typeof sr !== 'number' || typeof er !== 'number') return null
    if (typeof sc !== 'number' || typeof ec !== 'number') return null
    return { startRow: sr, endRow: er, startCol: sc, endCol: ec }
}

function criterionToYMap(criterion: FilterCriterion): Y.Map<unknown> {
    const out = new Y.Map<unknown>()
    if (criterion.type === 'values') {
        out.set('type', 'values')
        const arr = new Y.Array<string>()
        arr.push(criterion.allowedValues)
        out.set('allowedValues', arr)
        return out
    }
    out.set('type', 'condition')
    const cond = new Y.Map<unknown>()
    cond.set('op', criterion.condition.op)
    if ('value' in criterion.condition) {
        cond.set('value', criterion.condition.value)
    }
    out.set('condition', cond)
    return out
}

function criterionFromYMap(m: Y.Map<unknown>): FilterCriterion | null {
    const type = m.get('type')
    if (type === 'values') {
        const arr = m.get('allowedValues')
        if (arr instanceof Y.Array) {
            return { type: 'values', allowedValues: arr.toArray().filter(v => typeof v === 'string') }
        }
        if (Array.isArray(arr)) {
            return { type: 'values', allowedValues: arr.filter(v => typeof v === 'string') as string[] }
        }
        return { type: 'values', allowedValues: [] }
    }
    if (type === 'condition') {
        const cond = m.get('condition')
        if (!(cond instanceof Y.Map)) return null
        const op = cond.get('op')
        const valueRaw = cond.get('value')
        const value = typeof valueRaw === 'string' ? valueRaw : ''
        switch (op) {
            case 'gt':
            case 'lt':
            case 'eq':
            case 'neq':
            case 'contains':
            case 'startsWith':
            case 'endsWith':
                return { type: 'condition', condition: { op, value } }
            case 'isEmpty':
            case 'isNotEmpty':
                return { type: 'condition', condition: { op } }
            default:
                return null
        }
    }
    return null
}

// readFilterView returns a structured snapshot of the persisted filter
// view, or null when none is set. Used by UI components and the apply
// path to read the prior savedHeights so it can preserve user-set row
// heights across multiple apply→clear cycles.
export function readFilterView(doc: Y.Doc, sheetId: string): FilterDefinition | null {
    const meta = getMeta(doc, sheetId)
    if (meta == null) return null
    const view = meta.get(FILTER_VIEW_KEY)
    if (!(view instanceof Y.Map)) return null
    const rangeMap = view.get('range')
    if (!(rangeMap instanceof Y.Map)) return null
    const range = rangeFromYMap(rangeMap)
    if (range == null) return null

    const criteria: Record<number, FilterCriterion> = {}
    const critMap = view.get('criteria')
    if (critMap instanceof Y.Map) {
        critMap.forEach((value, key) => {
            const col = Number(key)
            if (!Number.isFinite(col)) return
            if (!(value instanceof Y.Map)) return
            const c = criterionFromYMap(value)
            if (c != null) criteria[col] = c
        })
    }

    const savedHeights: Record<number, number> = {}
    const heightsMap = view.get('savedHeights')
    if (heightsMap instanceof Y.Map) {
        heightsMap.forEach((value, key) => {
            const row = Number(key)
            if (!Number.isFinite(row)) return
            if (typeof value !== 'number') return
            savedHeights[row] = value
        })
    }

    return { range, criteria, savedHeights }
}

// applyFilter persists the criteria onto sheet metadata and writes
// rowHeights[row] = 0 for every non-matching data row in the range.
// Prior heights are stored in `savedHeights` (only on the first apply)
// so clearFilter can restore them. Header row (range.startRow) is
// always visible.
//
// Re-applying after a criteria change reuses the existing savedHeights
// and unhides any rows that now match again before re-hiding the new
// non-matchers.
export function applyFilter(
    doc: Y.Doc,
    sheetId: string,
    filterDef: { range: CellRange; criteria: Record<number, FilterCriterion> }
): void {
    const meta = getMeta(doc, sheetId)
    if (meta == null) return

    doc.transact(() => {
        const view = getOrCreateFilterView(meta)

        view.set('range', rangeToYMap(filterDef.range))
        const critMap = new Y.Map<unknown>()
        for (const [colKey, criterion] of Object.entries(filterDef.criteria)) {
            const col = Number(colKey)
            if (!Number.isFinite(col)) continue
            critMap.set(String(col), criterionToYMap(criterion))
        }
        view.set('criteria', critMap)

        // Capture the *pre-filter* heights map. If a prior savedHeights
        // exists (re-apply after criteria change), keep it — those are
        // the user's true heights; the current rowHeights map may
        // already carry our 0-overrides.
        let savedHeightsMap = view.get('savedHeights')
        if (!(savedHeightsMap instanceof Y.Map)) {
            savedHeightsMap = new Y.Map<unknown>()
            view.set('savedHeights', savedHeightsMap)
            const rh = meta.get(ROW_HEIGHTS_KEY)
            if (rh instanceof Y.Map) {
                rh.forEach((value, key) => {
                    if (typeof value !== 'number') return
                    const row = Number(key)
                    if (!Number.isFinite(row)) return
                    if (row < filterDef.range.startRow || row > filterDef.range.endRow) return
                    if (value === 0) return
                    ;(savedHeightsMap as Y.Map<unknown>).set(String(row), value)
                })
            }
        }

        let rowHeights = meta.get(ROW_HEIGHTS_KEY)
        if (!(rowHeights instanceof Y.Map)) {
            rowHeights = new Y.Map<number>()
            meta.set(ROW_HEIGHTS_KEY, rowHeights)
        }
        const heights = rowHeights as Y.Map<number>

        for (let r = filterDef.range.startRow + 1; r <= filterDef.range.endRow; r++) {
            const visible = rowMatches(doc, sheetId, r, filterDef.criteria)
            if (visible) {
                // Restore prior height if we'd previously hidden this
                // row; otherwise leave whatever the user set.
                const prior = (savedHeightsMap as Y.Map<unknown>).get(String(r))
                if (typeof prior === 'number') {
                    heights.set(String(r), prior)
                } else {
                    // Default-height row: drop any 0-override entry we
                    // might have written previously.
                    heights.delete(String(r))
                }
                continue
            }
            heights.set(String(r), 0)
        }
    }, LOCAL_ORIGIN)
}

// clearFilter restores prior row heights and removes the filter view
// entry. Heights stored in savedHeights are written back; rows we
// hid (height 0) but had no prior entry have their override deleted
// so they resume rendering at DEFAULT_ROW_HEIGHT.
export function clearFilter(doc: Y.Doc, sheetId: string): void {
    const meta = getMeta(doc, sheetId)
    if (meta == null) return
    const view = meta.get(FILTER_VIEW_KEY)
    if (!(view instanceof Y.Map)) return
    const rangeMap = view.get('range')
    if (!(rangeMap instanceof Y.Map)) {
        doc.transact(() => meta.delete(FILTER_VIEW_KEY), LOCAL_ORIGIN)
        return
    }
    const range = rangeFromYMap(rangeMap)
    if (range == null) {
        doc.transact(() => meta.delete(FILTER_VIEW_KEY), LOCAL_ORIGIN)
        return
    }
    doc.transact(() => {
        const heights = meta.get(ROW_HEIGHTS_KEY)
        if (heights instanceof Y.Map) {
            const savedHeightsMap = view.get('savedHeights')
            const isYMap = savedHeightsMap instanceof Y.Map
            for (let r = range.startRow; r <= range.endRow; r++) {
                const cur = heights.get(String(r))
                if (cur !== 0) continue
                const prior = isYMap ? (savedHeightsMap as Y.Map<unknown>).get(String(r)) : undefined
                if (typeof prior === 'number') {
                    ;(heights as Y.Map<number>).set(String(r), prior)
                } else {
                    heights.delete(String(r))
                }
            }
        }
        meta.delete(FILTER_VIEW_KEY)
    }, LOCAL_ORIGIN)
}

// distinctValuesForColumn returns the unique cell display strings in
// `colIndex` over the data rows of `range` (skipping the header).
// Used to populate the Values tab of the FilterDropdown. Empty strings
// are included as a single "(blanks)" candidate so the user can hide
// missing values.
export function distinctValuesForColumn(
    doc: Y.Doc,
    sheetId: string,
    range: CellRange,
    colIndex: number
): string[] {
    const seen = new Set<string>()
    for (let r = range.startRow + 1; r <= range.endRow; r++) {
        const display = readCellDisplay(doc, sheetId, r, colIndex)
        seen.add(display)
    }
    return [...seen].sort((a, b) => {
        if (a === '' && b !== '') return 1
        if (b === '' && a !== '') return -1
        return a.localeCompare(b)
    })
}
