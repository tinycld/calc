// Lay a GroupedTree out as a 2D cell grid, in the tabular form Google
// Sheets and Excel give an imported pivot.
// Header band (headerRowCount rows):
//   - With col fields: a caption row (the single value's caption in
//     the corner, then the col-field captions), one item row per col
//     field, and a value-caption row when there is more than one value.
//   - Without col fields: one row of row-field and value captions.
//   - The last header row carries the row-field captions.
// Left of the data block: one column per row field.
// Subtotal rows (rowSubtotals=true) appear inside the row band, grouped
// by the prefix tuple of the row keys. Grand totals are at the bottom /
// right. A grand-total column needs col fields and a grand-total row
// needs row fields: without them it would only repeat the one data
// column or row.

import { applyNumFmt } from '../number-format/format'
import type { CellValue, PivotDefinition, PivotField } from '../workbook-types'
import type { GroupedTree, RenderedPivot } from './types'

// With col fields, row 1 holds the captions and the item rows start below.
const FIRST_ITEM_ROW = 2

interface Layout {
    valueCount: number
    headerRowCount: number
    headerColCount: number
    showGrandTotalCol: boolean
    showGrandTotalRow: boolean
}

function planLayout(def: PivotDefinition): Layout {
    const hasCols = def.cols.length > 0
    const captionRows = hasCols ? 1 + def.cols.length : 0
    const valueRow = def.values.length > 1 ? 1 : 0
    return {
        valueCount: Math.max(1, def.values.length),
        headerRowCount: Math.max(1, captionRows + valueRow),
        headerColCount: def.rows.length,
        showGrandTotalCol: def.rowGrandTotals && hasCols,
        showGrandTotalRow: def.colGrandTotals && def.rows.length > 0,
    }
}

export function renderPivot(tree: GroupedTree, def: PivotDefinition): RenderedPivot {
    const layout = planLayout(def)
    const { valueCount, headerRowCount, headerColCount } = layout

    // Row band: each row key produces a render-row; if rowSubtotals,
    // group by the first row field and emit a subtotal after each group.
    const renderRows = buildRenderRows(tree, def)
    const renderCols = buildRenderCols(tree)

    const grandTotalRow = layout.showGrandTotalRow ? headerRowCount + renderRows.length + 1 : null
    const totalRows = grandTotalRow ?? headerRowCount + renderRows.length
    const dataCols = headerColCount + renderCols.length * valueCount
    const totalCols = Math.max(
        dataCols + (layout.showGrandTotalCol ? valueCount : 0),
        headerColCount + def.cols.length
    )

    const cells = new Map<string, CellValue>()
    const fieldLabelCells = new Set<string>()

    writeHeaderBand(cells, fieldLabelCells, def, layout, renderCols)

    for (let i = 0; i < renderRows.length; i++) {
        const r = renderRows[i]
        const renderRowIdx = headerRowCount + i + 1
        writeRowHeaders(cells, def, r, renderRowIdx)
        writeDataCells(cells, def, layout, tree, r, renderRowIdx, renderCols)
    }

    if (grandTotalRow != null) {
        writeGrandTotalRow(cells, def, layout, tree, renderCols, grandTotalRow)
    }

    return {
        rows: totalRows,
        cols: totalCols,
        cells,
        headerRowCount,
        headerColCount,
        fieldLabelCells,
        grandTotalRow,
    }
}

// ---------- render-row planning ----------

type RenderRow =
    | { kind: 'data'; tuple: string[]; key: string }
    | { kind: 'subtotal'; prefix: string[]; prefixKey: string }

type RenderCol = { tuple: string[]; key: string }

function buildRenderRows(tree: GroupedTree, def: PivotDefinition): RenderRow[] {
    if (tree.rowKeys.length === 0) {
        return [{ kind: 'data', tuple: [], key: JSON.stringify([]) }]
    }
    const out: RenderRow[] = []
    if (!def.rowSubtotals || def.rows.length < 2) {
        for (const t of tree.rowKeys) {
            out.push({ kind: 'data', tuple: t, key: JSON.stringify(t) })
        }
        return out
    }
    let prevPrefix: string | null = null
    let prevPrefixTuple: string[] = []
    for (const t of tree.rowKeys) {
        const prefix = t.slice(0, 1)
        const prefixKey = JSON.stringify(prefix)
        if (prevPrefix != null && prefixKey !== prevPrefix) {
            out.push({
                kind: 'subtotal',
                prefix: prevPrefixTuple,
                prefixKey: prevPrefix,
            })
        }
        out.push({ kind: 'data', tuple: t, key: JSON.stringify(t) })
        prevPrefix = prefixKey
        prevPrefixTuple = prefix
    }
    if (prevPrefix != null) {
        out.push({
            kind: 'subtotal',
            prefix: prevPrefixTuple,
            prefixKey: prevPrefix,
        })
    }
    return out
}

function buildRenderCols(tree: GroupedTree): RenderCol[] {
    if (tree.colKeys.length === 0) {
        return [{ tuple: [], key: JSON.stringify([]) }]
    }
    return tree.colKeys.map(t => ({ tuple: t, key: JSON.stringify(t) }))
}

// ---------- header writers ----------

function writeHeaderBand(
    cells: Map<string, CellValue>,
    fieldLabelCells: Set<string>,
    def: PivotDefinition,
    layout: Layout,
    renderCols: RenderCol[]
): void {
    const { valueCount, headerRowCount, headerColCount } = layout
    const setLabel = (key: string, text: string) => {
        cells.set(key, stringCell(text))
        fieldLabelCells.add(key)
    }
    const colBase = (j: number) => headerColCount + j * valueCount + 1
    const grandCol = colBase(renderCols.length)

    for (let i = 0; i < def.rows.length; i++) {
        setLabel(`${headerRowCount}:${i + 1}`, fieldCaption(def.rows[i]))
    }

    if (def.cols.length === 0) {
        for (let v = 0; v < def.values.length; v++) {
            cells.set(`1:${headerColCount + v + 1}`, stringCell(valueLabel(def, v)))
        }
        return
    }

    // The corner holds the value caption only when one value names the
    // whole data block and a row-header column exists to hold it.
    if (def.values.length === 1 && headerColCount > 0) {
        cells.set('1:1', stringCell(valueLabel(def, 0)))
    }
    for (let i = 0; i < def.cols.length; i++) {
        setLabel(`1:${headerColCount + i + 1}`, fieldCaption(def.cols[i]))
    }
    for (let level = 0; level < def.cols.length; level++) {
        for (let j = 0; j < renderCols.length; j++) {
            const text = renderCols[j].tuple[level] ?? ''
            cells.set(`${FIRST_ITEM_ROW + level}:${colBase(j)}`, stringCell(text))
        }
    }
    if (layout.showGrandTotalCol) {
        cells.set(`${FIRST_ITEM_ROW}:${grandCol}`, stringCell('Grand Total'))
    }
    if (def.values.length > 1) {
        const blocks = renderCols.length + (layout.showGrandTotalCol ? 1 : 0)
        for (let j = 0; j < blocks; j++) {
            for (let v = 0; v < def.values.length; v++) {
                cells.set(`${headerRowCount}:${colBase(j) + v}`, stringCell(valueLabel(def, v)))
            }
        }
    }
}

function writeRowHeaders(
    cells: Map<string, CellValue>,
    def: PivotDefinition,
    r: RenderRow,
    rowIdx: number
): void {
    if (r.kind === 'data') {
        for (let level = 0; level < def.rows.length; level++) {
            cells.set(`${rowIdx}:${level + 1}`, stringCell(r.tuple[level] ?? ''))
        }
        return
    }
    cells.set(`${rowIdx}:1`, stringCell(`${r.prefix[0]} Total`))
    for (let level = 1; level < def.rows.length; level++) {
        cells.set(`${rowIdx}:${level + 1}`, stringCell(''))
    }
}

function writeDataCells(
    cells: Map<string, CellValue>,
    def: PivotDefinition,
    layout: Layout,
    tree: GroupedTree,
    r: RenderRow,
    renderRowIdx: number,
    renderCols: RenderCol[]
): void {
    const { valueCount, headerColCount } = layout
    for (let j = 0; j < renderCols.length; j++) {
        const c = renderCols[j]
        const colBase = headerColCount + j * valueCount + 1
        const folded =
            r.kind === 'data'
                ? tree.cells.get(r.key)?.get(c.key)
                : subtotalCellValues(tree, def, r.prefixKey, c.key)
        for (let v = 0; v < valueCount; v++) {
            cells.set(`${renderRowIdx}:${colBase + v}`, numericCell(folded?.[v], def, v))
        }
    }
    if (layout.showGrandTotalCol) {
        const colBase = headerColCount + renderCols.length * valueCount + 1
        const totals =
            r.kind === 'data' ? tree.rowTotals.get(r.key) : rowSubtotalGrand(tree, def, r.prefixKey)
        for (let v = 0; v < valueCount; v++) {
            cells.set(`${renderRowIdx}:${colBase + v}`, numericCell(totals?.[v], def, v))
        }
    }
}

function writeGrandTotalRow(
    cells: Map<string, CellValue>,
    def: PivotDefinition,
    layout: Layout,
    tree: GroupedTree,
    renderCols: RenderCol[],
    grandRow: number
): void {
    const { valueCount, headerColCount } = layout
    cells.set(`${grandRow}:1`, stringCell('Grand Total'))
    for (let j = 0; j < renderCols.length; j++) {
        const c = renderCols[j]
        const colBase = headerColCount + j * valueCount + 1
        const totals = tree.colTotals.get(c.key)
        for (let v = 0; v < valueCount; v++) {
            cells.set(`${grandRow}:${colBase + v}`, numericCell(totals?.[v], def, v))
        }
    }
    if (layout.showGrandTotalCol) {
        const colBase = headerColCount + renderCols.length * valueCount + 1
        for (let v = 0; v < valueCount; v++) {
            cells.set(`${grandRow}:${colBase + v}`, numericCell(tree.grandTotals[v], def, v))
        }
    }
}

// ---------- subtotal numeric folds ----------
//
// rowTotals/colTotals already contain the per-row / per-col grand totals.
// For row subtotals at the prefix-tuple level, we walk the tree and sum
// only the data cells whose row tuple starts with `prefix`. This re-fold
// is good enough for v1 where subtotals are only shown for additive
// aggregations (sum/count/min/max/product/countNums) — non-additive
// aggregations (average, stdDev, var) don't compose this way and will
// be revisited when subtotals graduate beyond additive folds.

function subtotalCellValues(
    tree: GroupedTree,
    def: PivotDefinition,
    prefixKey: string,
    colKey: string
): number[] | undefined {
    const prefix = JSON.parse(prefixKey) as string[]
    const result = new Array(def.values.length).fill(0)
    let touched = false
    for (const [rk, byCol] of tree.cells) {
        const tuple = JSON.parse(rk) as string[]
        if (!tupleStartsWith(tuple, prefix)) continue
        const folded = byCol.get(colKey)
        if (folded == null) continue
        for (let v = 0; v < def.values.length; v++) {
            result[v] += folded[v]
        }
        touched = true
    }
    return touched ? result : undefined
}

function rowSubtotalGrand(tree: GroupedTree, def: PivotDefinition, prefixKey: string): number[] {
    const prefix = JSON.parse(prefixKey) as string[]
    const result = new Array(def.values.length).fill(0)
    for (const [rk, totals] of tree.rowTotals) {
        const tuple = JSON.parse(rk) as string[]
        if (!tupleStartsWith(tuple, prefix)) continue
        for (let v = 0; v < def.values.length; v++) {
            result[v] += totals[v]
        }
    }
    return result
}

function tupleStartsWith(tuple: string[], prefix: string[]): boolean {
    if (prefix.length > tuple.length) return false
    for (let i = 0; i < prefix.length; i++) {
        if (tuple[i] !== prefix[i]) return false
    }
    return true
}

// ---------- cell builders ----------

function stringCell(s: string): CellValue {
    return { kind: 'string', raw: s, display: s }
}

function numericCell(n: number | undefined, def: PivotDefinition, valueIdx: number): CellValue {
    if (n == null || !Number.isFinite(n)) {
        return { kind: 'string', raw: '', display: '' }
    }
    const numFmt = def.values[valueIdx]?.numFmt
    const display = applyNumFmt('number', n, numFmt)
    return {
        kind: 'number',
        raw: n,
        display,
        style: numFmt ? { numFmt } : undefined,
    }
}

// An imported displayName is already the whole caption ("SUM of Total"),
// so the aggregation prefix applies only to the default caption.
function valueLabel(def: PivotDefinition, valueIdx: number): string {
    const v = def.values[valueIdx]
    if (v == null) return ''
    return v.displayName ?? `${aggregationVerb(v.aggregation)} of ${v.sourceColumn}`
}

function fieldCaption(f: PivotField): string {
    return f.displayName ?? f.sourceColumn
}

function aggregationVerb(agg: PivotDefinition['values'][number]['aggregation']): string {
    switch (agg) {
        case 'sum':
            return 'Sum'
        case 'average':
            return 'Average'
        case 'count':
            return 'Count'
        case 'countNums':
            return 'Count Nums'
        case 'max':
            return 'Max'
        case 'min':
            return 'Min'
        case 'product':
            return 'Product'
        case 'stdDev':
            return 'StdDev'
        case 'stdDevp':
            return 'StdDevP'
        case 'var':
            return 'Var'
        case 'varp':
            return 'VarP'
    }
}
