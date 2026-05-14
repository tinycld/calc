import { ScrollView, Text, View } from 'react-native'
import * as Y from 'yjs'
import { useRenderedPivot } from '../../hooks/use-rendered-pivot'
import type { PivotDefinition } from '../../lib/workbook-types'
import { PivotBanner } from './PivotBanner'
import { PivotEmptyState } from './PivotEmptyState'
import {
    buildPivotGridCellMatrix,
    type PivotGridCellMeta,
    selectPivotGridViewState,
} from './pivot-grid-view-state'

// Read-only renderer for a pivot output sheet. The engine produces a
// 2D grid of CellValue; we lay it out with simple absolute-width
// cells. Selection, copy, find/replace all flow through this same
// cell map in later integration tasks — for v1 the grid is purely
// visual. The view-state decision (empty / error / grid) lives in
// ./pivot-grid-view-state so it can be unit-tested without RN.
export interface PivotGridProps {
    doc: Y.Doc
    def: PivotDefinition
    onOpenSidePanel: () => void
}

export function PivotGrid({ doc, def, onOpenSidePanel }: PivotGridProps) {
    const result = useRenderedPivot(doc, def)
    const view = selectPivotGridViewState(def, result)

    if (view.kind === 'empty') {
        return <PivotEmptyState onOpenSidePanel={onOpenSidePanel} />
    }
    if (view.kind === 'error') {
        return <PivotBanner error={view.error} onEdit={onOpenSidePanel} />
    }
    const matrix = buildPivotGridCellMatrix(view.rendered)
    return (
        <ScrollView horizontal className="flex-1 bg-background">
            <ScrollView className="flex-1">
                <View>
                    {matrix.map((row, rIdx) => (
                        <PivotRow key={`r${rIdx + 1}`} cells={row} />
                    ))}
                </View>
            </ScrollView>
        </ScrollView>
    )
}

interface PivotRowProps {
    cells: PivotGridCellMeta[]
}

function PivotRow({ cells }: PivotRowProps) {
    return (
        <View className="flex-row">
            {cells.map((cell) => (
                <PivotCell key={`${cell.row}:${cell.col}`} cell={cell} />
            ))}
        </View>
    )
}

interface PivotCellProps {
    cell: PivotGridCellMeta
}

function PivotCell({ cell }: PivotCellProps) {
    const containerClass = cell.isHeader
        ? 'min-w-[96px] border-r border-b border-border px-2 py-1 bg-surface-secondary'
        : 'min-w-[96px] border-r border-b border-border px-2 py-1 bg-background'
    const textClass = cell.isHeader
        ? 'text-xs font-medium text-foreground'
        : 'text-xs text-foreground'
    return (
        <View className={containerClass}>
            <Text className={textClass}>{cell.display}</Text>
        </View>
    )
}
