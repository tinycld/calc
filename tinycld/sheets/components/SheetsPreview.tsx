import { useQuery } from '@tanstack/react-query'
import type { PreviewProps } from '@tinycld/core/file-viewer/types'
import { useAuthedFileURL } from '@tinycld/core/file-viewer/use-authed-file-url'
import { ActivityIndicator, Text, View } from 'react-native'
import { parseWorkbook, type WorkbookModel } from '../lib/xlsx-adapter'
import { Grid } from './Grid'

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

    return (
        <View className="flex-1 bg-background">
            <Grid sheet={workbook.sheets[0]} />
        </View>
    )
}
