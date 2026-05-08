import { useQuery } from '@tanstack/react-query'
import type { PreviewProps } from '@tinycld/core/file-viewer/types'
import { useAuthedFileURL } from '@tinycld/core/file-viewer/use-authed-file-url'
import { useEffect } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { parseWorkbook, type WorkbookModel } from '../lib/xlsx-adapter'
import { useWorkbookStore } from '../stores/workbook-store'
import { Grid } from './Grid'

export function SheetsPreview({ source }: PreviewProps) {
    const { url, isLoading: isTokenLoading } = useAuthedFileURL(source)
    const previewId = `preview:${source.recordId}`

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

    const setWorkbook = useWorkbookStore((s) => s.setWorkbook)
    const discardWorkbook = useWorkbookStore((s) => s.discardWorkbook)
    const hasWorkbook = useWorkbookStore((s) => s.workbooks[previewId] != null)

    useEffect(() => {
        if (workbook) setWorkbook(previewId, workbook)
    }, [workbook, previewId, setWorkbook])

    useEffect(() => () => discardWorkbook(previewId), [previewId, discardWorkbook])

    if (isTokenLoading || isParseLoading || !hasWorkbook) {
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

    return (
        <View className="flex-1 bg-background">
            <Grid workbookId={previewId} sheetIndex={0} readOnly />
        </View>
    )
}
