import { useQuery } from '@tanstack/react-query'
import type { PreviewProps } from '@tinycld/core/file-viewer/types'
import { pb } from '@tinycld/core/lib/pocketbase'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { cellKey, columnLabel, type WorkbookModel } from '../lib/workbook-types'

const CELL_WIDTH = 96
const CELL_HEIGHT = 28
const ROW_HEADER_WIDTH = 48
const PREVIEW_MAX_ROWS = 50
const PREVIEW_MAX_COLS = 26

// CalcPreview renders a non-collaborative, read-only view of an .xlsx
// file. It pulls the parsed grid from /api/calc/preview/:id — the
// server is the only component that ever touches xlsx bytes. Rendering
// the response payload directly keeps the preview decoupled from the
// live realtime session (no surprise edits leaking from in-progress
// editing into viewers who haven't opened the editor).
export function CalcPreview({ source }: PreviewProps) {
    const {
        data: workbook,
        isLoading,
        error,
    } = useQuery<WorkbookModel>({
        queryKey: ['calc', 'preview', source.recordId],
        queryFn: () =>
            pb.send<WorkbookModel>(`/api/calc/preview/${source.recordId}`, { method: 'GET' }),
    })

    if (isLoading) {
        return (
            <View className="flex-1 items-center justify-center">
                <ActivityIndicator />
            </View>
        )
    }

    if (error) {
        return (
            <View className="flex-1 items-center justify-center px-4">
                <Text className="text-sm text-muted-foreground">
                    Could not open spreadsheet: {error.message}
                </Text>
            </View>
        )
    }

    if (!workbook || workbook.sheets.length === 0) {
        return (
            <View className="flex-1 items-center justify-center">
                <Text className="text-sm text-muted-foreground">Spreadsheet is empty.</Text>
            </View>
        )
    }

    const sheet = workbook.sheets[0]
    const rows = Math.min(Math.max(sheet.rowCount, 1), PREVIEW_MAX_ROWS)
    const cols = Math.min(Math.max(sheet.colCount, 1), PREVIEW_MAX_COLS)

    return (
        <View className="flex-1 bg-background">
            <ScrollView horizontal>
                <ScrollView>
                    <View>
                        <ColumnHeaderRow cols={cols} />
                        {Array.from({ length: rows }, (_, rowIdx) => {
                            const row = rowIdx + 1
                            return <PreviewRow key={row} sheet={sheet} row={row} cols={cols} />
                        })}
                    </View>
                </ScrollView>
            </ScrollView>
        </View>
    )
}

function ColumnHeaderRow({ cols }: { cols: number }) {
    return (
        <View className="flex-row">
            <View
                className="bg-surface-secondary border-r border-b border-border"
                style={{ width: ROW_HEADER_WIDTH, height: CELL_HEIGHT }}
            />
            {Array.from({ length: cols }, (_, colIdx) => {
                const col = colIdx + 1
                return (
                    <View
                        key={col}
                        className="bg-surface-secondary border-r border-b border-border items-center justify-center"
                        style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                    >
                        <Text className="text-xs text-muted-foreground">{columnLabel(col)}</Text>
                    </View>
                )
            })}
        </View>
    )
}

interface PreviewRowProps {
    sheet: WorkbookModel['sheets'][number]
    row: number
    cols: number
}

function PreviewRow({ sheet, row, cols }: PreviewRowProps) {
    return (
        <View className="flex-row">
            <View
                className="bg-surface-secondary border-r border-b border-border items-center justify-center"
                style={{ width: ROW_HEADER_WIDTH, height: CELL_HEIGHT }}
            >
                <Text className="text-xs text-muted-foreground">{row}</Text>
            </View>
            {Array.from({ length: cols }, (_, colIdx) => {
                const col = colIdx + 1
                const cell = sheet.cells[cellKey(row, col)]
                return (
                    <View
                        key={col}
                        className="border-r border-b border-border bg-background justify-center px-1"
                        style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                    >
                        <Text className="text-xs text-foreground" numberOfLines={1}>
                            {cell?.display ?? ''}
                        </Text>
                    </View>
                )
            })}
        </View>
    )
}
