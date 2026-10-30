import { useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { measureColumnText } from '../../hooks/use-column-resize'
import { useRenderedPivot } from '../../hooks/use-rendered-pivot'
import { useYSheets } from '../../hooks/use-y-sheets'
import { DEFAULT_ROW_HEIGHT } from '../../lib/dimensions'
import { usePivotPanelStore } from '../../lib/stores/pivot-panel-store'
import type { PivotDefinition } from '../../lib/workbook-types'
import { GridCanvasTheme } from '../grid/GridCanvasTheme'
import { PivotBanner } from './PivotBanner'
import { PivotEmptyState } from './PivotEmptyState'
import { PivotSidePanel } from './PivotSidePanel'
import {
    buildPivotGridCellMatrix,
    type PivotGridCellMeta,
    type PivotGridViewState,
    pivotColumnWidths,
    selectPivotGridViewState,
    selectPivotPanelOpen,
} from './pivot-grid-view-state'

// Read-only renderer for a pivot output sheet. The engine produces a
// 2D grid of CellValue; we lay it out with one fixed width per column
// so the cells line up like the normal grid. Selection, copy, find/replace all flow through this same
// cell map in later integration tasks — for v1 the grid is purely
// visual. The view-state decision (empty / error / grid) lives in
// ./pivot-grid-view-state so it can be unit-tested without RN.
//
// The PivotSidePanel mounts as a sibling whenever
// usePivotPanelStore.openForSheetId equals this grid's sheetId — the
// store keys by sheet id (not pivot id) because Grid.tsx already has
// sheetId in scope when it opens the panel, and per-sheet keying keeps
// concurrent grids' panels independent. The selectPivotPanelOpen pure
// helper makes the conditional testable without RN.
export interface PivotGridProps {
    doc: Y.Doc
    def: PivotDefinition
    sheetId: string
    onOpenSidePanel: () => void
    readOnly?: boolean
}

export function PivotGrid({ doc, def, sheetId, onOpenSidePanel, readOnly }: PivotGridProps) {
    const result = useRenderedPivot(doc, def)
    const openForSheetId = usePivotPanelStore(s => s.openForSheetId)
    const close = usePivotPanelStore(s => s.close)
    const view = selectPivotGridViewState(def, result)
    const panelOpen = selectPivotPanelOpen(openForSheetId, sheetId)
    // An imported pivot sheet keeps the source file's hidden gridlines.
    const showGridLines = useYSheets(doc).find(s => s.id === sheetId)?.hideGridLines !== true
    return (
        <View testID="calc-grid-root" className="flex-1">
            <PivotBody
                view={view}
                onOpenSidePanel={onOpenSidePanel}
                showGridLines={showGridLines}
            />
            <PivotSidePanel
                doc={doc}
                def={def}
                isOpen={panelOpen}
                onClose={close}
                readOnly={readOnly}
            />
        </View>
    )
}

interface PivotBodyProps {
    view: ReturnType<typeof selectPivotGridViewState>
    onOpenSidePanel: () => void
    showGridLines: boolean
}

function PivotBody({ view, onOpenSidePanel, showGridLines }: PivotBodyProps) {
    if (view.kind === 'empty') {
        return <PivotEmptyState onOpenSidePanel={onOpenSidePanel} />
    }
    if (view.kind === 'error') {
        return <PivotBanner error={view.error} onEdit={onOpenSidePanel} />
    }
    return <PivotMatrix rendered={view.rendered} showGridLines={showGridLines} />
}

interface PivotMatrixProps {
    rendered: Extract<PivotGridViewState, { kind: 'grid' }>['rendered']
    showGridLines: boolean
}

function usePivotMatrix(rendered: PivotMatrixProps['rendered']) {
    return useMemo(() => {
        const matrix = buildPivotGridCellMatrix(rendered)
        return { matrix, widths: pivotColumnWidths(matrix, measureColumnText) }
    }, [rendered])
}

function PivotMatrix({ rendered, showGridLines }: PivotMatrixProps) {
    const { matrix, widths } = usePivotMatrix(rendered)
    const rows = matrix.map(row => (
        <PivotRow
            key={`r${row[0]?.row ?? 0}`}
            cells={row}
            widths={widths}
            showGridLines={showGridLines}
        />
    ))
    const frameClass = showGridLines ? 'self-start border-l border-t border-border' : 'self-start'
    // Pinned to the light palette for the same reason as the main grid:
    // the pivot data area reads as a spreadsheet canvas, so it stays a
    // light "paper" surface in dark mode (see GridCanvasTheme).
    return (
        <GridCanvasTheme>
            <ScrollView horizontal className="flex-1 bg-background">
                <ScrollView className="flex-1">
                    <View className={frameClass}>{rows}</View>
                </ScrollView>
            </ScrollView>
        </GridCanvasTheme>
    )
}

interface PivotRowProps {
    cells: PivotGridCellMeta[]
    widths: number[]
    showGridLines: boolean
}

function PivotRow({ cells, widths, showGridLines }: PivotRowProps) {
    const items = cells.map((cell, i) => (
        <PivotCell
            key={`${cell.row}:${cell.col}`}
            cell={cell}
            width={widths[i]}
            showGridLines={showGridLines}
        />
    ))
    return <View className="flex-row">{items}</View>
}

interface PivotCellProps {
    cell: PivotGridCellMeta
    width: number
    showGridLines: boolean
}

function PivotCell({ cell, width, showGridLines }: PivotCellProps) {
    const { container, text } = pivotCellClasses(cell, showGridLines)
    return (
        <View className={container} style={{ width, height: DEFAULT_ROW_HEIGHT }}>
            <Text className={text} numberOfLines={1}>
                {cell.display}
            </Text>
        </View>
    )
}

// Sheets' pivot look: a tinted header band, italic field captions, a
// bold grand-total row under a rule, and right-aligned numbers.
function pivotCellClasses(cell: PivotGridCellMeta, showGridLines: boolean) {
    const container = [
        'justify-center overflow-hidden px-1',
        showGridLines ? 'border-r border-b border-border' : '',
        cell.isHeader ? 'bg-muted/10' : 'bg-background',
        cell.isGrandTotal ? 'border-t border-t-muted' : '',
    ]
    const text = [
        'text-xs text-foreground',
        cell.isFieldLabel ? 'italic' : '',
        cell.isGrandTotal ? 'font-bold' : '',
        cell.isNumber ? 'text-right' : '',
    ]
    return { container: joinClasses(container), text: joinClasses(text) }
}

function joinClasses(parts: string[]): string {
    return parts.filter(Boolean).join(' ')
}
