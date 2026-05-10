import type { ExportedCellChange, HyperFormula, RawCellContent, SimpleCellAddress } from 'hyperformula'
import * as Y from 'yjs'
import { setYCellFormulaResult } from '../../hooks/use-y-cell'
import { parseYCellKey, yCellKey } from '../y-cell-key'
import { CELLS_MAP, readYCell, SHEETS_MAP, type YCellValue, ydocSheetIds } from '../y-doc-bootstrap'
import { HYPERFORMULA_LICENSE_KEY } from './hyperformula-license'
import { hfInputForCell, normalizeHfValue } from './normalize'
import { FORMULA_ORIGIN } from './origins'

// FormulaBridge mirrors the calc Y.Doc into a HyperFormula instance,
// listens for HF's recompute results, and writes the cached scalars
// back into the Y.Doc tagged FORMULA_ORIGIN.
//
// One bridge per Y.Doc. Lifecycle is owned by useFormulaBridge — call
// .stop() before discarding so observers and HF resources release.
//
// Re-entrancy: HF -> Y.Doc writeback uses FORMULA_ORIGIN; the
// observeDeep callback short-circuits on that origin so HF doesn't
// re-receive its own outputs.
export class FormulaBridge {
    private readonly doc: Y.Doc
    private readonly hf: HyperFormula
    // Y.Doc sheet ids are strings ('sheet1'); HF identifies sheets by
    // numeric ids assigned at addSheet time. Maintain both directions
    // so observers can translate without scanning.
    private readonly sheetIdToHf: Map<string, number> = new Map()
    private readonly hfToSheetId: Map<number, string> = new Map()
    private cellsObserver: ((events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => void) | null = null
    private sheetsObserver: ((event: Y.YMapEvent<Y.Map<unknown>>, txn: Y.Transaction) => void) | null = null
    private valuesUpdatedHandler: ((changes: ReadonlyArray<unknown>) => void) | null = null

    constructor(doc: Y.Doc, hf: HyperFormula) {
        this.doc = doc
        this.hf = hf
    }

    // start runs the cold-start pass (mirror current doc state into HF
    // and let HF's first recompute populate any missing formula raws)
    // then attaches the live observers.
    //
    // Listener ordering matters: attach valuesUpdated BEFORE
    // bootstrapCells so the initial recompute that setSheetContent
    // triggers is captured and written back into the Y.Doc. Attaching
    // it later misses the cold-start results.
    start(): void {
        this.bootstrapSheets()
        this.attachValuesUpdatedListener()
        this.bootstrapCells()
        this.attachDocObservers()
    }

    stop(): void {
        if (this.cellsObserver != null) {
            this.doc.getMap<Y.Map<unknown>>(CELLS_MAP).unobserveDeep(this.cellsObserver)
            this.cellsObserver = null
        }
        if (this.sheetsObserver != null) {
            this.doc.getMap<Y.Map<unknown>>(SHEETS_MAP).unobserve(this.sheetsObserver)
            this.sheetsObserver = null
        }
        if (this.valuesUpdatedHandler != null) {
            // tiny-emitter's off accepts the listener that was registered;
            // pass the same fn reference we attached.
            this.hf.off('valuesUpdated', this.valuesUpdatedHandler as never)
            this.valuesUpdatedHandler = null
        }
        // HF holds its own dependency graph and parser caches; release
        // them so a stop/start cycle (e.g. doc swap) doesn't leak.
        this.hf.destroy()
    }

    private bootstrapSheets(): void {
        const sheetsMap = this.doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        for (const sheetId of ydocSheetIds(this.doc)) {
            const meta = sheetsMap.get(sheetId)
            const name = meta?.get('name')
            const sheetName = typeof name === 'string' && name !== '' ? name : sheetId
            // HF requires unique sheet names. If the doc has a name
            // collision (shouldn't happen via the UI, but guards against
            // old data), suffix with the sheetId.
            const uniqueName = this.hf.doesSheetExist(sheetName) ? `${sheetName} (${sheetId})` : sheetName
            const added = this.hf.addSheet(uniqueName)
            const hfId = this.hf.getSheetId(added)
            if (hfId == null) continue
            this.sheetIdToHf.set(sheetId, hfId)
            this.hfToSheetId.set(hfId, sheetId)
        }
    }

    private bootstrapCells(): void {
        const cellsMap = this.doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        // Gather cells per sheet so we can use setSheetContent (one
        // batch per sheet) instead of N setCellContents calls. HF
        // doesn't fire valuesUpdated until the bulk apply finishes,
        // which is what we want for the cold-start pass.
        const grids: Map<number, RawCellContent[][]> = new Map()
        const sizes: Map<number, { rows: number; cols: number }> = new Map()

        cellsMap.forEach((cell, key) => {
            const parsed = parseYCellKey(key)
            if (parsed == null) return
            const hfId = this.sheetIdToHf.get(parsed.sheetId)
            if (hfId == null) return
            const value = readYCell(cell)
            const hfValue = hfInputForCell(value)
            if (hfValue == null) return
            let grid = grids.get(hfId)
            if (grid == null) {
                grid = []
                grids.set(hfId, grid)
            }
            // HF is 0-indexed.
            const r = parsed.row - 1
            const c = parsed.col - 1
            while (grid.length <= r) grid.push([])
            const row = grid[r]
            while (row.length <= c) row.push(null)
            row[c] = hfValue
            const size = sizes.get(hfId) ?? { rows: 0, cols: 0 }
            if (r + 1 > size.rows) size.rows = r + 1
            if (c + 1 > size.cols) size.cols = c + 1
            sizes.set(hfId, size)
        })

        for (const [hfId, grid] of grids) {
            // Pad missing cells with null so setSheetContent receives a
            // rectangular grid (HF requires uniform row lengths).
            const size = sizes.get(hfId)
            if (size == null) continue
            for (const row of grid) {
                while (row.length < size.cols) row.push(null)
            }
            this.hf.setSheetContent(hfId, grid)
        }
    }

    private attachValuesUpdatedListener(): void {
        const handler = (changes: ReadonlyArray<unknown>) => {
            this.applyHfChanges(changes as ReadonlyArray<ExportedCellChange>)
        }
        this.valuesUpdatedHandler = handler
        this.hf.on('valuesUpdated', handler as never)
    }

    private applyHfChanges(changes: ReadonlyArray<ExportedCellChange>): void {
        if (changes.length === 0) return
        for (const change of changes) {
            // ExportedNamedExpressionChange has no .address — skip
            // anything that isn't a cell change.
            const address = (change as ExportedCellChange).address as SimpleCellAddress | undefined
            if (address == null) continue
            const sheetId = this.hfToSheetId.get(address.sheet)
            if (sheetId == null) continue
            const raw = normalizeHfValue((change as ExportedCellChange).newValue)
            // HF is 0-indexed; the doc is 1-indexed. setYCellFormulaResult
            // wraps the write in a FORMULA_ORIGIN transaction and skips
            // non-formula / no-op writes internally.
            setYCellFormulaResult(this.doc, sheetId, address.row + 1, address.col + 1, raw)
        }
    }

    private attachDocObservers(): void {
        const cellsMap = this.doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const sheetsMap = this.doc.getMap<Y.Map<unknown>>(SHEETS_MAP)

        const cellsObserver = (events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => {
            // Skip our own writebacks — HF emitted them and we wrote
            // them with FORMULA_ORIGIN. Re-forwarding them into HF would
            // start a feedback loop.
            if (txn.origin === FORMULA_ORIGIN) return
            const touched: Set<string> = new Set()
            for (const evt of events) {
                if (evt.target === cellsMap) {
                    // Top-level add/delete of a cell entry.
                    for (const key of (evt as Y.YMapEvent<unknown>).keysChanged) touched.add(key)
                } else {
                    // Nested change inside a cell Y.Map (or its style
                    // sub-map). Walk back up to find the parent key.
                    const parent = findTopLevelCellKey(evt, cellsMap)
                    if (parent != null) touched.add(parent)
                }
            }
            for (const key of touched) {
                this.forwardCell(key)
            }
        }
        this.cellsObserver = cellsObserver
        cellsMap.observeDeep(cellsObserver)

        const sheetsObserver = (event: Y.YMapEvent<Y.Map<unknown>>) => {
            for (const sheetId of event.keysChanged) {
                if (this.sheetIdToHf.has(sheetId)) continue
                const meta = sheetsMap.get(sheetId)
                if (meta == null || !(meta instanceof Y.Map)) continue
                const name = meta.get('name')
                const sheetName = typeof name === 'string' && name !== '' ? name : sheetId
                const uniqueName = this.hf.doesSheetExist(sheetName) ? `${sheetName} (${sheetId})` : sheetName
                const added = this.hf.addSheet(uniqueName)
                const hfId = this.hf.getSheetId(added)
                if (hfId == null) continue
                this.sheetIdToHf.set(sheetId, hfId)
                this.hfToSheetId.set(hfId, sheetId)
            }
        }
        this.sheetsObserver = sheetsObserver
        sheetsMap.observe(sheetsObserver)
    }

    private forwardCell(key: string): void {
        const parsed = parseYCellKey(key)
        if (parsed == null) return
        const hfId = this.sheetIdToHf.get(parsed.sheetId)
        if (hfId == null) return
        const cellsMap = this.doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cell = cellsMap.get(yCellKey(parsed.sheetId, parsed.row, parsed.col))
        const value: YCellValue | null = cell == null ? null : readYCell(cell)
        const hfValue = hfInputForCell(value)
        const address: SimpleCellAddress = { sheet: hfId, row: parsed.row - 1, col: parsed.col - 1 }
        this.hf.setCellContents(address, hfValue)
    }
}

// findTopLevelCellKey walks an observeDeep event's path back up to the
// top-level CELLS_MAP key it belongs to. Returns null when the event
// did not originate inside a tracked cell entry.
function findTopLevelCellKey(evt: Y.YEvent<Y.AbstractType<unknown>>, cellsMap: Y.Map<Y.Map<unknown>>): string | null {
    // evt.path is an array from CELLS_MAP root down to the changed
    // type's parent (so [<cellKey>, ...]). For events on the cell
    // Y.Map itself (e.g. raw/display set), the path is [<cellKey>].
    // For events on the nested style Y.Map, it's [<cellKey>, 'style'].
    if (evt.path.length === 0) return null
    const head = evt.path[0]
    if (typeof head !== 'string') return null
    // Defensive: only forward keys that still resolve under CELLS_MAP.
    if (!cellsMap.has(head)) {
        // Cell was deleted in this transaction; the deletion itself
        // arrives via the parent map event handled separately. Forward
        // the key anyway so HF clears its side.
        return head
    }
    return head
}

// createFormulaBridge instantiates HyperFormula via dynamic import so
// HF's ~250KB only loads when calc actually runs. Returns a started
// bridge ready to mirror the doc.
export async function createFormulaBridge(doc: Y.Doc): Promise<FormulaBridge> {
    const { HyperFormula } = await import('hyperformula')
    const hf = HyperFormula.buildEmpty({
        licenseKey: HYPERFORMULA_LICENSE_KEY,
    })
    const bridge = new FormulaBridge(doc, hf)
    bridge.start()
    return bridge
}
