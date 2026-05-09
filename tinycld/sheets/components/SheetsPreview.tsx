import { useQuery } from '@tanstack/react-query'
import type { PreviewProps } from '@tinycld/core/file-viewer/types'
import { useAuthedFileURL } from '@tinycld/core/file-viewer/use-authed-file-url'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { cellKey, columnLabel, parseWorkbook, type WorkbookModel } from '../lib/xlsx-adapter'

const CELL_WIDTH = 96
const CELL_HEIGHT = 28
const ROW_HEADER_WIDTH = 48
const PREVIEW_MAX_ROWS = 50
const PREVIEW_MAX_COLS = 26

// SheetsPreview renders a non-collaborative, read-only view of an
// .xlsx file. It does NOT open a realtime WebSocket — the preview pane is
// fire-and-forget and must not participate in editing. Sharing Y.Doc
// state with the detail screen would couple the preview to the live
// session (and would surface any in-progress edits to viewers who
// haven't opened the editor proper).
export function SheetsPreview({ source }: PreviewProps) {
    const { url, isLoading: isTokenLoading } = useAuthedFileURL(source)

    const {
        data: workbook,
        isLoading: isParseLoading,
        error,
    } = useQuery<WorkbookModel>({
        queryKey: ['sheets', 'preview', source.recordId, source.fileName],
        queryFn: async () => {
            const resp = await fetch(url)
            if (!resp.ok) throw new Error(`Could not download spreadsheet (${resp.status})`)
            const buffer = await resp.arrayBuffer()
            return parseWorkbook(buffer)
        },
        enabled: !!url,
    })

    if (isTokenLoading || isParseLoading) {
        return (
            <View className="flex-1 items-center justify-center">
                <ActivityIndicator />
            </View>
        )
    }

    if (error) {
        return (
            <View className="flex-1 items-center justify-center px-4">
                <Text className="text-sm text-muted-foreground">Could not open spreadsheet: {error.message}</Text>
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
